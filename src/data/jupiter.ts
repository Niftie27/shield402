import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";

/**
 * Well-known Solana token mint addresses.
 *
 * Jupiter requires mint addresses, not symbols.
 * This map covers the most common pairs for v1.
 * If a symbol is not found, we skip the Jupiter check.
 */
const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  ORCA: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
  WSOL: "So11111111111111111111111111111111111111112",
};

export interface JupiterQuoteResult {
  /** Price impact as a decimal string, e.g. "0.12" means 0.12% */
  priceImpactPct: number;
  /** Expected output amount in atomic units */
  outAmount: string;
  /** Number of routes Jupiter found */
  routeCount: number;
}

const JUPITER_QUOTE_URL = "https://api.jup.ag/swap/v1/quote";
const JUPITER_TIMEOUT_MS = 3000;

/**
 * Fetch a price quote from Jupiter for the given trade.
 *
 * Returns null if:
 * - token mints are not known
 * - API key is not set
 * - the request fails or times out
 *
 * Never throws — caller should still handle errors defensively.
 */
export async function fetchJupiterQuote(
  trade: ValidatedTradeCheck,
): Promise<JupiterQuoteResult | null> {
  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) return null;

  // Parse pair into input/output symbols
  const symbols = parsePairSymbols(trade.pair);
  if (!symbols) return null;

  const inputMint = TOKEN_MINTS[symbols.input];
  const outputMint = TOKEN_MINTS[symbols.output];
  if (!inputMint || !outputMint) return null;

  // Convert amount to atomic units (lamports for SOL, 6 decimals for USDC/USDT)
  const decimals = getTokenDecimals(symbols.input);
  const atomicAmount = Math.round(trade.amount_in * 10 ** decimals);

  const url = new URL(JUPITER_QUOTE_URL);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", atomicAmount.toString());
  url.searchParams.set("slippageBps", trade.slippage_bps.toString());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JUPITER_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = await response.json();

    const priceImpactPct = parseFloat(data.priceImpactPct ?? "0");
    if (isNaN(priceImpactPct)) return null;

    return {
      priceImpactPct,
      outAmount: data.outAmount ?? "0",
      routeCount: data.routePlan?.length ?? 0,
    };
  } catch {
    // Timeout, network error, or parse error — fail open
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse a pair string like "SOL/USDC" into input and output symbols.
 */
function parsePairSymbols(
  pair: string,
): { input: string; output: string } | null {
  const parts = pair.toUpperCase().split("/");
  if (parts.length !== 2) return null;
  return { input: parts[0].trim(), output: parts[1].trim() };
}

/**
 * Token decimal places for atomic unit conversion.
 * SOL = 9, most SPL stablecoins = 6.
 */
function getTokenDecimals(symbol: string): number {
  switch (symbol) {
    case "SOL":
    case "WSOL":
      return 9;
    case "USDC":
    case "USDT":
      return 6;
    default:
      return 6; // reasonable default for most SPL tokens
  }
}

import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import { resolveDecimals } from "./mints";

export interface JupiterQuoteResult {
  /** Price impact as a percentage, e.g. 0.12 means 0.12%. Null if not reported by Jupiter. */
  priceImpactPct: number | null;
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
 * Uses mint addresses directly from the validated request.
 * No symbol resolution needed.
 *
 * Returns null if the API responded but had no useful data (e.g. unknown token).
 * Throws on transport failures (network error, timeout, HTTP 5xx) so the caller
 * can detect degraded state.
 */
export async function fetchJupiterQuote(
  trade: ValidatedTradeCheck,
): Promise<JupiterQuoteResult | null> {
  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) return null;

  // Resolve decimals: hardcoded for well-known tokens, on-chain for the rest.
  // If we can't determine decimals, skip Jupiter rather than guess.
  const decimals = await resolveDecimals(trade.input_mint);
  if (decimals === null) return null;

  const atomicAmount = Math.round(trade.amount_in * 10 ** decimals);

  const url = new URL(JUPITER_QUOTE_URL);
  url.searchParams.set("inputMint", trade.input_mint);
  url.searchParams.set("outputMint", trade.output_mint);
  url.searchParams.set("amount", atomicAmount.toString());
  url.searchParams.set("slippageBps", trade.slippage_bps.toString());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JUPITER_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Jupiter API returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    // priceImpactPct: null if missing, reject if present but unparseable
    let priceImpactPct: number | null = null;
    if (data.priceImpactPct != null) {
      const parsed = parseFloat(String(data.priceImpactPct));
      if (isNaN(parsed)) return null;
      priceImpactPct = parsed;
    }

    const routePlan = data.routePlan;

    return {
      priceImpactPct,
      outAmount: String(data.outAmount ?? "0"),
      routeCount: Array.isArray(routePlan) ? routePlan.length : 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Shared token mint utilities.
 *
 * The policy engine works with mint addresses directly.
 * This module provides:
 * - A symbol→mint map (used by the Telegram bot for user-friendly input)
 * - Decimal resolution by mint (used by Jupiter for atomic unit conversion)
 * - Base58 validation
 */

/** Well-known Solana mint address for SOL/WSOL. */
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Well-known Solana token mint addresses.
 *
 * Used by the Telegram bot to resolve user-friendly symbols.
 * The policy engine never uses this map — it receives mints directly.
 */
export const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  ORCA: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
  WSOL: "So11111111111111111111111111111111111111112",
};

/**
 * Check if a string looks like a Solana base58 mint address.
 * Solana addresses are 32-44 characters of base58 (no 0, O, I, l).
 */
export function isMintAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

/**
 * Token decimal places by mint address for atomic unit conversion.
 * SOL = 9, most SPL stablecoins = 6. Defaults to 6 for unknown tokens.
 */
const KNOWN_DECIMALS: Record<string, number> = {
  "So11111111111111111111111111111111111111112": 9,  // SOL / WSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": 6,  // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": 6,  // USDT
};

export function hasKnownDecimals(mint: string): boolean {
  return mint in KNOWN_DECIMALS;
}

export function getTokenDecimals(mint: string): number {
  return KNOWN_DECIMALS[mint] ?? 6;
}

/**
 * Parse a symbol pair string like "SOL/USDC" into input and output symbols.
 * Used by the Telegram bot — not by the policy engine.
 */
export function parsePairSymbols(
  pair: string,
): { input: string; output: string } | null {
  const parts = pair.split("/");
  if (parts.length !== 2) return null;
  return { input: parts[0].trim().toUpperCase(), output: parts[1].trim().toUpperCase() };
}

/**
 * Resolve a symbol to a mint address.
 * Returns the mint if the symbol is known, or null.
 * If the input is already a mint address, passes it through.
 * Used by the Telegram bot for user-friendly input.
 */
export function resolveSymbolToMint(symbol: string): string | null {
  if (isMintAddress(symbol)) return symbol;
  return TOKEN_MINTS[symbol.toUpperCase()] ?? null;
}

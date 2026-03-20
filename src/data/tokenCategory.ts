/**
 * Token category classification.
 *
 * Maps known token mints to behavioral categories that inform rule
 * evaluation. Categories describe what the token IS, not what to do
 * with it — rules decide how to treat each category.
 *
 * Current use: tokenSafetyRule suppresses structurally expected
 * Shield warnings (e.g. HAS_FREEZE_AUTHORITY on USDC) for stable
 * tokens only.
 *
 * Future use: category-specific thresholds for slippage, size,
 * and liquidity rules. Adding those is additive — just read the
 * category in the relevant rule and branch on it.
 *
 * Unknown tokens (not in this map) default to "unknown", which
 * preserves all current rule behavior unchanged.
 */

export type TokenCategory = "stable" | "major" | "meme" | "unknown";

/**
 * Explicit category assignments for known tokens.
 *
 * Stable: regulated stablecoins where mint/freeze authority is
 * structurally expected (Circle, Tether).
 *
 * Major: high-liquidity, widely traded tokens where mint/freeze
 * authority would be genuinely alarming.
 *
 * Meme: high-volatility community tokens. Currently treated the
 * same as unknown by rules, but separated so future threshold
 * overrides can distinguish them.
 *
 * This map is intentionally small and conservative. A token must
 * be well-established and structurally understood to be listed.
 */
const CATEGORY_BY_MINT: Record<string, TokenCategory> = {
  // --- Stablecoins ---
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "stable",  // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "stable",  // USDT

  // --- Major tokens ---
  "So11111111111111111111111111111111111111112": "major",      // SOL / WSOL
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": "major",   // JUP
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "major",  // RAY
  "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE": "major",   // ORCA

  // --- Meme tokens ---
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": "meme",  // BONK
};

/**
 * Get the category for a token mint.
 * Returns "unknown" for any mint not in the map.
 */
export function getTokenCategory(mint: string): TokenCategory {
  return CATEGORY_BY_MINT[mint] ?? "unknown";
}

/**
 * Shield warning types that are structurally expected for stable tokens.
 *
 * Circle (USDC) and Tether (USDT) intentionally retain mint and freeze
 * authority for regulatory compliance. Jupiter Shield correctly reports
 * these, but they are not risk signals for these specific tokens.
 *
 * Only applied when the token is categorized as "stable".
 */
export const STABLE_EXPECTED_WARNINGS: Set<string> = new Set([
  "HAS_MINT_AUTHORITY",
  "HAS_FREEZE_AUTHORITY",
]);

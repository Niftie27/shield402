import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { LiveContext } from "../data/liveContext";
import type { Rule } from "./rule";

/**
 * Liquidity depth rule — flags tokens with dangerously low liquidity.
 *
 * Two complementary signals:
 * 1. Absolute liquidity floor — Jupiter Tokens V2 `liquidity` field gives total
 *    USD liquidity across all pools. Tokens below $1K are extremely dangerous;
 *    below $10K is still thin.
 * 2. Price impact + low liquidity cross-check — if Jupiter quote shows meaningful
 *    price impact AND liquidity is under $500K, the trade is large relative to
 *    available depth. This catches cases that pass the absolute floor but are
 *    still risky for the specific trade.
 *
 * Note: we intentionally don't compute a trade-to-liquidity ratio because we can't
 * reliably estimate trade USD value from raw token units (100 BONK ≠ 100 SOL).
 * Price impact from the Jupiter quote is a better signal for "trade is too large
 * for this pool."
 *
 * Uses output token liquidity because that's the pool the trade impacts.
 */

/** Minimum liquidity in USD below which we flag regardless of trade size. */
const MIN_LIQUIDITY_WARN = 10_000;     // $10K
const MIN_LIQUIDITY_BLOCK = 1_000;     // $1K

export const liquidityDepthRule: Rule = {
  id: "low_liquidity",
  description: "Flags tokens with dangerously low liquidity or high price impact in thin markets.",

  evaluate(_trade: ValidatedTradeCheck, liveContext?: LiveContext): RuleResult {
    const outputToken = liveContext?.jupiter_token_output;

    // No liquidity data — fail open
    if (!outputToken?.liquidity) {
      return {
        rule_id: "low_liquidity",
        triggered: false,
        severity: "low",
        message: "Liquidity depth check skipped (no token liquidity data available).",
      };
    }

    const liquidity = outputToken.liquidity;
    const symbol = outputToken.symbol ?? "output token";

    // Absolute liquidity floor — extremely thin markets
    if (liquidity < MIN_LIQUIDITY_BLOCK) {
      return {
        rule_id: "low_liquidity",
        triggered: true,
        severity: "high",
        message: `${symbol} has only $${formatUsd(liquidity)} total liquidity. Extremely thin market — high risk of total loss.`,
      };
    }

    if (liquidity < MIN_LIQUIDITY_WARN) {
      return {
        rule_id: "low_liquidity",
        triggered: true,
        severity: "caution",
        message: `${symbol} has only $${formatUsd(liquidity)} total liquidity. Thin market — trade with caution.`,
      };
    }

    // Price impact + low liquidity cross-check.
    // High price impact = trade is large relative to the routed pool.
    // priceImpactRule handles impact alone; this rule adds liquidity context.
    // Check high-severity branch first — it's a subset of the caution branch.
    const jupiterQuote = liveContext?.jupiter;

    if (jupiterQuote && jupiterQuote.priceImpactPct > 2.0 && liquidity < 500_000) {
      return {
        rule_id: "low_liquidity",
        triggered: true,
        severity: "high",
        message: `${symbol} has $${formatUsd(liquidity)} total liquidity with ${jupiterQuote.priceImpactPct.toFixed(2)}% price impact. Trade significantly exceeds available liquidity.`,
      };
    }

    if (jupiterQuote && jupiterQuote.priceImpactPct > 0.5 && liquidity < 100_000) {
      return {
        rule_id: "low_liquidity",
        triggered: true,
        severity: "caution",
        message: `${symbol} has $${formatUsd(liquidity)} total liquidity with ${jupiterQuote.priceImpactPct.toFixed(2)}% price impact. Trade is large relative to available liquidity.`,
      };
    }

    return {
      rule_id: "low_liquidity",
      triggered: false,
      severity: "low",
      message: `${symbol} has $${formatUsd(liquidity)} total liquidity. Adequate for this trade.`,
    };
  },
};

/** Format USD amount with commas and no decimals for readability. */
function formatUsd(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K`;
  return amount.toFixed(0);
}

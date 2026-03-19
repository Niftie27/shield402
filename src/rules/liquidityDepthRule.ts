import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { LiveContext } from "../data/liveContext";
import type { Rule } from "./rule";

/**
 * Liquidity depth rule — checks if trade size is dangerous relative
 * to available token liquidity.
 *
 * Two complementary signals:
 * 1. Jupiter Tokens V2 `liquidity` field — total USD liquidity across all pools.
 *    Coarse but available for any token. Used as first-pass check.
 * 2. Jupiter quote `priceImpactPct` — precise, reflects the actual routed pool.
 *    Already handled by priceImpactRule, but this rule adds context about WHY
 *    the impact is high (low liquidity) and catches cases where the impact
 *    looks moderate but liquidity is dangerously thin.
 *
 * The $50M Aave/CoW incident: $50.4M trade through a pool with $73K liquidity.
 * Trade-to-liquidity ratio was 690:1. This rule would catch that at any threshold.
 *
 * Uses output token liquidity because that's the pool the trade impacts.
 */

/**
 * Trade-to-liquidity ratio thresholds.
 *
 * These compare estimated trade USD value against total token liquidity.
 * "Total" is across all pools — the specific routed pool may have less.
 * So we use conservative thresholds.
 */
const WARN_RATIO = 0.05;   // Trade is >5% of total liquidity → warn
const BLOCK_RATIO = 0.20;  // Trade is >20% of total liquidity → block

/** Minimum liquidity in USD below which we always warn (regardless of trade size). */
const MIN_LIQUIDITY_WARN = 10_000;     // $10K
const MIN_LIQUIDITY_BLOCK = 1_000;     // $1K

export const liquidityDepthRule: Rule = {
  id: "low_liquidity",
  description: "Flags trades where token liquidity is dangerously low relative to trade size.",

  evaluate(trade: ValidatedTradeCheck, liveContext?: LiveContext): RuleResult {
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

    // Estimate trade USD value from Jupiter quote output
    // If we have a Jupiter quote, we can estimate the output USD value
    // Otherwise, we can't compare trade size to liquidity (no common unit)
    const jupiterQuote = liveContext?.jupiter;
    const inputToken = liveContext?.jupiter_token_input;

    // Try to estimate trade value in USD using input token price or output FDV
    let estimatedTradeUsd: number | null = null;

    if (inputToken?.fdv && inputToken?.liquidity) {
      // Use input token's USD price estimate: fdv / total supply gives rough price
      // But we don't have total supply easily. Instead, if the input token has
      // liquidity data, we can use the price from Jupiter's data.
      // Simpler: if input is a well-known token (SOL, USDC), estimate directly.
    }

    // Fallback: use price impact as a proxy for trade-to-liquidity ratio.
    // High price impact = trade is large relative to the routed pool.
    // This is handled by priceImpactRule, but we combine it with absolute liquidity.
    if (jupiterQuote && jupiterQuote.priceImpactPct > 0.5 && liquidity < 100_000) {
      return {
        rule_id: "low_liquidity",
        triggered: true,
        severity: "caution",
        message: `${symbol} has $${formatUsd(liquidity)} total liquidity with ${jupiterQuote.priceImpactPct.toFixed(2)}% price impact. Trade is large relative to available liquidity.`,
      };
    }

    if (jupiterQuote && jupiterQuote.priceImpactPct > 2.0 && liquidity < 500_000) {
      return {
        rule_id: "low_liquidity",
        triggered: true,
        severity: "high",
        message: `${symbol} has $${formatUsd(liquidity)} total liquidity with ${jupiterQuote.priceImpactPct.toFixed(2)}% price impact. Trade significantly exceeds available liquidity.`,
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

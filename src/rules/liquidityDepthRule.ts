import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { LiveContext } from "../data/liveContext";
import type { Rule } from "./rule";

/**
 * Liquidity depth rule — flags tokens with dangerously low liquidity.
 *
 * Shows BOTH input and output token liquidity when available, and highlights
 * the weaker side. Threshold decisions are based on the weaker token.
 *
 * Does NOT claim route-level depth modeling — that requires detailed Jupiter
 * route data we don't yet persist. Price impact from the quote is used as
 * a complementary cross-check signal.
 *
 * Two complementary signals:
 * 1. Absolute liquidity floor — Jupiter Tokens V2 `liquidity` field gives total
 *    USD liquidity across all pools. Tokens below $1K are extremely dangerous;
 *    below $10K is still thin.
 * 2. Price impact + low liquidity cross-check — if Jupiter quote shows meaningful
 *    price impact AND liquidity is under $500K, the trade is large relative to
 *    available depth.
 */

/** Minimum liquidity in USD below which we flag regardless of trade size. */
const MIN_LIQUIDITY_WARN = 10_000;     // $10K
const MIN_LIQUIDITY_BLOCK = 1_000;     // $1K

interface TokenSide {
  liquidity: number;
  symbol: string;
  side: "input" | "output";
}

export const liquidityDepthRule: Rule = {
  id: "low_liquidity",
  description: "Flags tokens with dangerously low liquidity or high price impact in thin markets.",

  evaluate(_trade: ValidatedTradeCheck, liveContext?: LiveContext): RuleResult {
    const inputToken = liveContext?.jupiter_token_input;
    const outputToken = liveContext?.jupiter_token_output;

    // Build both sides
    const inputSide: TokenSide | null = inputToken?.liquidity != null
      ? { liquidity: inputToken.liquidity, symbol: inputToken.symbol ?? "input token", side: "input" }
      : null;
    const outputSide: TokenSide | null = outputToken?.liquidity != null
      ? { liquidity: outputToken.liquidity, symbol: outputToken.symbol ?? "output token", side: "output" }
      : null;

    if (!inputSide && !outputSide) {
      return {
        rule_id: "low_liquidity",
        triggered: false,
        severity: "low",
        message: "Liquidity depth check skipped (no token liquidity data available).",
      };
    }

    // Weakest side drives threshold decisions
    const weakest = inputSide && outputSide
      ? (inputSide.liquidity <= outputSide.liquidity ? inputSide : outputSide)
      : (inputSide ?? outputSide)!;

    const { liquidity, symbol } = weakest;

    const jupiterQuote = liveContext?.jupiter;
    const priceImpactPct = jupiterQuote?.priceImpactPct ?? null;

    // Build the both-sides summary line
    const pairSummary = formatPairSummary(inputSide, outputSide);

    // Evidence always includes full both-sides data
    const baseEvidence = {
      input_symbol: inputSide?.symbol ?? null,
      input_liquidity_usd: inputSide?.liquidity ?? null,
      output_symbol: outputSide?.symbol ?? null,
      output_liquidity_usd: outputSide?.liquidity ?? null,
      weaker_side: weakest.side,
      weaker_symbol: weakest.symbol,
      weaker_liquidity_usd: weakest.liquidity,
      price_impact_pct: priceImpactPct,
      threshold_warn: MIN_LIQUIDITY_WARN,
      threshold_block: MIN_LIQUIDITY_BLOCK,
    };

    // Absolute liquidity floor — extremely thin markets
    if (liquidity < MIN_LIQUIDITY_BLOCK) {
      return {
        rule_id: "low_liquidity",
        triggered: true,
        severity: "high",
        message: `${pairSummary}. Extremely thin liquidity on ${symbol} — high risk of total loss.`,
        evidence: { ...baseEvidence, trigger: "below_block_floor" },
      };
    }

    if (liquidity < MIN_LIQUIDITY_WARN) {
      return {
        rule_id: "low_liquidity",
        triggered: true,
        severity: "caution",
        message: `${pairSummary}. Thin liquidity on ${symbol} — trade with caution.`,
        evidence: { ...baseEvidence, trigger: "below_warn_floor" },
      };
    }

    // Price impact + low liquidity cross-check
    const impact = jupiterQuote?.priceImpactPct;

    if (impact != null && impact > 2.0 && liquidity < 500_000) {
      return {
        rule_id: "low_liquidity",
        triggered: true,
        severity: "high",
        message: `${pairSummary}. ${symbol} liquidity with ${impact.toFixed(2)}% price impact — trade significantly exceeds available depth.`,
        evidence: { ...baseEvidence, trigger: "high_impact_low_liquidity" },
      };
    }

    if (impact != null && impact > 0.5 && liquidity < 100_000) {
      return {
        rule_id: "low_liquidity",
        triggered: true,
        severity: "caution",
        message: `${pairSummary}. ${symbol} liquidity with ${impact.toFixed(2)}% price impact — trade is large relative to available depth.`,
        evidence: { ...baseEvidence, trigger: "moderate_impact_low_liquidity" },
      };
    }

    // Adequate — show both sides, highlight weaker
    const weakerNote = inputSide && outputSide
      ? ` Weaker side: ${weakest.symbol}.`
      : "";

    return {
      rule_id: "low_liquidity",
      triggered: false,
      severity: "low",
      message: `${pairSummary}. Adequate for this trade.${weakerNote}`,
      evidence: { ...baseEvidence, trigger: "none" },
    };
  },
};

/**
 * Build "Input JUP $2.0M · Output USDC $483.5M" summary.
 * Shows only available sides — never invents the missing one.
 */
function formatPairSummary(input: TokenSide | null, output: TokenSide | null): string {
  const parts: string[] = [];
  if (input) parts.push(`Input ${input.symbol} $${formatUsd(input.liquidity)}`);
  if (output) parts.push(`Output ${output.symbol} $${formatUsd(output.liquidity)}`);
  return parts.join(" · ");
}

/** Format USD amount for readability. */
function formatUsd(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K`;
  return amount.toFixed(0);
}

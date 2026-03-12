import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { LiveContext } from "../data/liveContext";
import type { Rule } from "./rule";

/**
 * Price impact thresholds (percentage).
 *
 * These are based on common DeFi conventions:
 * - < 1%: normal for most trades
 * - 1-5%: elevated, worth a warning
 * - > 5%: high, the trade will move the market significantly
 */
const CAUTION_THRESHOLD_PCT = 1;
const HIGH_THRESHOLD_PCT = 5;

/**
 * Flags trades where Jupiter reports significant price impact.
 *
 * This is the first live-data rule. It requires Jupiter quote data
 * in the live context. If Jupiter data is missing (API down, unconfigured,
 * or unknown token), the rule returns a neutral "no data" result.
 */
export const priceImpactRule: Rule = {
  id: "high_price_impact",
  description: "Flags trades with high price impact based on Jupiter quote data.",

  evaluate(trade: ValidatedTradeCheck, liveContext?: LiveContext): RuleResult {
    const jupiter = liveContext?.jupiter;

    // No Jupiter data — fail open, don't flag
    if (!jupiter) {
      return {
        rule_id: "high_price_impact",
        triggered: false,
        severity: "low",
        message: "Price impact check skipped (no live data available).",
      };
    }

    const impact = jupiter.priceImpactPct;

    if (impact >= HIGH_THRESHOLD_PCT) {
      return {
        rule_id: "high_price_impact",
        triggered: true,
        severity: "high",
        message: `Price impact is ${impact.toFixed(2)}%. This trade will significantly move the market against you.`,
      };
    }

    if (impact >= CAUTION_THRESHOLD_PCT) {
      return {
        rule_id: "high_price_impact",
        triggered: true,
        severity: "caution",
        message: `Price impact is ${impact.toFixed(2)}%. Consider reducing trade size or splitting into smaller trades.`,
      };
    }

    return {
      rule_id: "high_price_impact",
      triggered: false,
      severity: "low",
      message: `Price impact is ${impact.toFixed(2)}%, within normal range.`,
    };
  },
};

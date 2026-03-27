import { riskConfig } from "../config/riskConfig";
import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { Rule } from "./rule";

/**
 * Rule: Slippage too wide.
 *
 * High slippage tolerance makes a trade easier to sandwich.
 * A searcher can push the price against you up to your slippage limit
 * and profit from the difference.
 *
 * Thresholds are configurable in riskConfig.
 */
export const slippageRule: Rule = {
  id: "slippage_too_wide",
  description: "Flags trades where slippage tolerance is higher than recommended.",

  evaluate(trade: ValidatedTradeCheck): RuleResult {
    const { slippage_bps } = trade;
    const { cautionAboveBps, highAboveBps } = riskConfig.slippage;

    if (slippage_bps > highAboveBps) {
      return {
        rule_id: this.id,
        triggered: true,
        severity: "high",
        message: `Slippage of ${slippage_bps} bps is very wide. This makes the trade easy to sandwich.`,
        evidence: { current_bps: slippage_bps, threshold_caution: cautionAboveBps, threshold_high: highAboveBps },
      };
    }

    if (slippage_bps > cautionAboveBps) {
      return {
        rule_id: this.id,
        triggered: true,
        severity: "caution",
        message: `Slippage of ${slippage_bps} bps is wider than recommended.`,
        evidence: { current_bps: slippage_bps, threshold_caution: cautionAboveBps, threshold_high: highAboveBps },
      };
    }

    return {
      rule_id: this.id,
      triggered: false,
      severity: "low",
      message: `Slippage of ${slippage_bps} bps is within acceptable range.`,
    };
  },
};

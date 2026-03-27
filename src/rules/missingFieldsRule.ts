import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { Rule } from "./rule";

/**
 * Rule: Missing important execution parameters.
 *
 * If the caller omits priority_fee_lamports entirely, they may not
 * have considered landing quality at all. This isn't necessarily
 * dangerous, but it's worth flagging — especially for larger trades.
 */
export const missingFieldsRule: Rule = {
  id: "missing_execution_params",
  description: "Flags trades that are missing optional but important execution fields.",

  evaluate(trade: ValidatedTradeCheck): RuleResult {
    const missing: string[] = [];

    if (trade.priority_fee_lamports === undefined) {
      missing.push("priority_fee_lamports");
    }

    if (missing.length === 0) {
      return {
        rule_id: this.id,
        triggered: false,
        severity: "low",
        message: "All important execution parameters are present.",
      };
    }

    return {
      rule_id: this.id,
      triggered: true,
      severity: "caution",
      message: `Missing execution parameters: ${missing.join(", ")}. Consider specifying these for better landing quality.`,
      evidence: { missing },
    };
  },
};

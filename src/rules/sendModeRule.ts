import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { Rule } from "./rule";

/**
 * Rule: Unprotected or unknown send mode.
 *
 * Trades sent via standard RPC (not through Jito bundles or similar
 * protected paths) are more exposed to sandwich attacks.
 *
 * "unknown" is treated as caution because the caller may not have
 * considered send-mode at all.
 */
export const sendModeRule: Rule = {
  id: "unprotected_send_mode",
  description: "Flags trades that are not using a protected send path.",

  evaluate(trade: ValidatedTradeCheck): RuleResult {
    const { send_mode } = trade;

    if (send_mode === "protected") {
      return {
        rule_id: this.id,
        triggered: false,
        severity: "low",
        message: "Send mode is protected.",
      };
    }

    if (send_mode === "unknown") {
      return {
        rule_id: this.id,
        triggered: true,
        severity: "caution",
        message: "Send mode is unknown. Consider using a protected send path.",
        evidence: { current_mode: send_mode, recommended_mode: "protected" },
      };
    }

    // send_mode === "standard"
    return {
      rule_id: this.id,
      triggered: true,
      severity: "caution",
      message: "Standard send mode offers no MEV protection. Consider using a protected path (e.g. Jito bundles).",
      evidence: { current_mode: send_mode, recommended_mode: "protected" },
    };
  },
};

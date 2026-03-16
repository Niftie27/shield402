import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { LiveContext } from "../data/liveContext";
import type { RugcheckResult } from "../data/rugcheck";
import type { Rule } from "./rule";

/**
 * Rugcheck score thresholds.
 *
 * Based on Rugcheck's own risk tiers:
 * - > 80: RUGGED / EXTREME RISK → block
 * - > 40: HIGH / MODERATE RISK  → warn
 * - ≤ 40: LOW RISK              → pass
 */
const BLOCK_THRESHOLD = 80;
const WARN_THRESHOLD = 40;

/**
 * Flags trades involving tokens with high risk scores from Rugcheck.
 *
 * Checks BOTH input and output tokens. The worst score wins.
 * This catches both buy-side risk (acquiring a scam token) and
 * sell-side risk (e.g. a user holding a token with freeze authority).
 *
 * If Rugcheck data is missing (API down, unconfigured, or unknown token),
 * the rule returns a neutral result — fail open.
 */
export const tokenRiskRule: Rule = {
  id: "token_risk",
  description: "Flags trades involving tokens with high risk scores from Rugcheck.",

  evaluate(_trade: ValidatedTradeCheck, liveContext?: LiveContext): RuleResult {
    const inputRisk = liveContext?.rugcheck_input;
    const outputRisk = liveContext?.rugcheck_output;

    if (!inputRisk && !outputRisk) {
      return {
        rule_id: "token_risk",
        triggered: false,
        severity: "low",
        message: "Token risk check skipped (no Rugcheck data available).",
      };
    }

    // Use the worst score between input and output
    const worstReport = pickWorst(inputRisk, outputRisk);
    if (!worstReport) {
      return {
        rule_id: "token_risk",
        triggered: false,
        severity: "low",
        message: "Token risk check skipped (no Rugcheck data available).",
      };
    }

    const { score, risks } = worstReport.report;
    const side = worstReport.side;
    const topRiskName = risks[0]?.name ?? "unknown risk";
    const topRiskDesc = risks[0]?.description ?? "";

    if (score > BLOCK_THRESHOLD) {
      return {
        rule_id: "token_risk",
        triggered: true,
        severity: "high",
        message: `${side} token risk score is ${score} (extreme). Top risk: ${topRiskName}. ${topRiskDesc}`.trim(),
      };
    }

    if (score > WARN_THRESHOLD) {
      return {
        rule_id: "token_risk",
        triggered: true,
        severity: "caution",
        message: `${side} token risk score is ${score} (elevated). Top risk: ${topRiskName}. ${topRiskDesc}`.trim(),
      };
    }

    return {
      rule_id: "token_risk",
      triggered: false,
      severity: "low",
      message: `Token risk scores within acceptable range (input: ${inputRisk?.score ?? "n/a"}, output: ${outputRisk?.score ?? "n/a"}).`,
    };
  },
};

/** Pick the report with the highest score. */
function pickWorst(
  input?: RugcheckResult,
  output?: RugcheckResult,
): { report: RugcheckResult; side: "Input" | "Output" } | null {
  if (!input && !output) return null;
  if (!input) return { report: output!, side: "Output" };
  if (!output) return { report: input, side: "Input" };
  return input.score >= output.score
    ? { report: input, side: "Input" }
    : { report: output, side: "Output" };
}

import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult, RiskLevel, Confidence, TradeCheckResult } from "../types/result";
import type { Rule } from "./rule";

import { slippageRule } from "./slippageRule";
import { sendModeRule } from "./sendModeRule";
import { sizeRiskRule } from "./sizeRiskRule";
import { missingFieldsRule } from "./missingFieldsRule";
import { unsafeCombinationRule } from "./unsafeCombinationRule";

/**
 * All active rules, in evaluation order.
 *
 * Adding a new rule = add it to this array. That's it.
 */
const allRules: Rule[] = [
  slippageRule,
  sendModeRule,
  sizeRiskRule,
  missingFieldsRule,
  unsafeCombinationRule,
];

/**
 * Severity ranking for comparison.
 */
const severityRank: Record<RiskLevel, number> = {
  low: 0,
  caution: 1,
  high: 2,
};

/**
 * Determine overall risk level from individual rule results.
 * Simple policy: the highest severity wins.
 */
function aggregateRiskLevel(results: RuleResult[]): RiskLevel {
  let maxRank = 0;
  for (const r of results) {
    if (r.triggered && severityRank[r.severity] > maxRank) {
      maxRank = severityRank[r.severity];
    }
  }

  if (maxRank >= 2) return "high";
  if (maxRank >= 1) return "caution";
  return "low";
}

/**
 * Pick the most relevant reason from triggered rules.
 * Prefers the highest-severity triggered rule's message.
 */
function pickReason(results: RuleResult[]): string {
  const triggered = results
    .filter((r) => r.triggered)
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);

  if (triggered.length === 0) {
    return "No risk factors detected in this trade configuration.";
  }

  if (triggered.length === 1) {
    return triggered[0].message;
  }

  // Multiple triggers: lead with the worst, mention count.
  return `${triggered[0].message} (${triggered.length} risk factors detected)`;
}

/**
 * Generate one actionable recommendation based on triggered rules.
 */
function pickRecommendation(
  results: RuleResult[],
  trade: ValidatedTradeCheck
): string {
  const triggered = results
    .filter((r) => r.triggered)
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);

  if (triggered.length === 0) {
    return "Trade configuration looks reasonable. Proceed normally.";
  }

  // Recommend based on the highest-priority triggered rule.
  const worst = triggered[0];

  switch (worst.rule_id) {
    case "unsafe_combination":
      return "Tighten slippage, switch to protected send mode, and consider splitting the trade.";

    case "slippage_too_wide":
      return `Reduce slippage to ${
        trade.slippage_bps > 300 ? "100 bps or lower" : "75 bps or lower"
      }.`;

    case "large_trade_loose_settings":
      return "Tighten slippage, increase priority fee, or split into smaller trades.";

    case "unprotected_send_mode":
      return "Switch to a protected send path (e.g. Jito bundles with DontFront).";

    case "missing_execution_params":
      return "Specify priority_fee_lamports for better transaction landing.";

    default:
      return "Review trade parameters before sending.";
  }
}

/**
 * Determine confidence level.
 *
 * v1 is always "medium" because we're running static rules
 * without live chain data. This is honest — we're not pretending
 * to know more than we do.
 *
 * When v2 adds live data, confidence can go up.
 */
function determineConfidence(_results: RuleResult[]): Confidence {
  return "medium";
}

/**
 * Run all rules against a validated trade and return the full result.
 *
 * This is the core of Shield402 Lite. Everything else is plumbing.
 */
export function evaluateTrade(trade: ValidatedTradeCheck): TradeCheckResult {
  const ruleResults = allRules.map((rule) => rule.evaluate(trade));

  const riskLevel = aggregateRiskLevel(ruleResults);
  const reason = pickReason(ruleResults);
  const recommendation = pickRecommendation(ruleResults, trade);
  const confidence = determineConfidence(ruleResults);
  const triggeredRules = ruleResults
    .filter((r) => r.triggered)
    .map((r) => r.rule_id);

  return {
    risk_level: riskLevel,
    reason,
    recommendation,
    confidence,
    triggered_rules: triggeredRules,
    rule_details: ruleResults,
  };
}

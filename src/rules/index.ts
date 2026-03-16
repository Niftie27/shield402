import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type {
  RuleResult,
  RiskLevel,
  Confidence,
  PolicyDecision,
  PolicyRecommendation,
  TradeCheckResult,
} from "../types/result";
import type { LiveContext } from "../data/liveContext";
import type { Rule } from "./rule";

import { slippageRule } from "./slippageRule";
import { sendModeRule } from "./sendModeRule";
import { sizeRiskRule } from "./sizeRiskRule";
import { missingFieldsRule } from "./missingFieldsRule";
import { unsafeCombinationRule } from "./unsafeCombinationRule";
import { priceImpactRule } from "./priceImpactRule";
import { tokenRiskRule } from "./tokenRiskRule";

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
  priceImpactRule,
  tokenRiskRule,
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

    case "high_price_impact":
      return "Reduce trade size or split into smaller trades to lower price impact.";

    case "token_risk":
      return "Token flagged by risk scanner. Review token safety before trading.";

    default:
      return "Review trade parameters before sending.";
  }
}

/**
 * Determine confidence level.
 *
 * - "medium" when running static rules only (no live data).
 * - "high" when any live data source (Jupiter or Rugcheck) is available.
 *
 * This is honest — we tell callers when we have real data vs heuristics.
 */
function determineConfidence(liveContext?: LiveContext): Confidence {
  if (liveContext?.jupiter || liveContext?.rugcheck_input || liveContext?.rugcheck_output) return "high";
  return "medium";
}

/**
 * Determine which live data providers contributed to this assessment.
 */
function determineLiveSources(liveContext?: LiveContext): string[] {
  const sources: string[] = [];
  if (liveContext?.jupiter) sources.push("jupiter");
  if (liveContext?.rugcheck_input || liveContext?.rugcheck_output) sources.push("rugcheck");
  return sources;
}

/**
 * Map risk level to a policy decision.
 *
 * - low    → allow  (proceed normally)
 * - caution → warn  (consider adjustments)
 * - high   → block  (do not send as-is)
 */
function deriveDecision(riskLevel: RiskLevel): PolicyDecision {
  switch (riskLevel) {
    case "low": return "allow";
    case "caution": return "warn";
    case "high": return "block";
  }
}

/**
 * Generate concrete safer parameters based on triggered rules.
 *
 * Only populated when decision is "warn" or "block".
 * A bot can use these values directly instead of parsing the reason string.
 */
function buildPolicyRecommendation(
  riskLevel: RiskLevel,
  triggeredRuleIds: string[],
  trade: ValidatedTradeCheck,
): PolicyRecommendation {
  if (riskLevel === "low") return {};

  const policy: PolicyRecommendation = {};
  const triggered = new Set(triggeredRuleIds);

  // Recommend tighter slippage
  if (triggered.has("slippage_too_wide") || triggered.has("unsafe_combination") || triggered.has("large_trade_loose_settings")) {
    // For very wide slippage, recommend 50 bps. Otherwise 75 bps.
    policy.recommended_slippage_bps = trade.slippage_bps > 300 ? 50 : 75;
  }

  // Recommend protected send
  if (triggered.has("unprotected_send_mode") || triggered.has("unsafe_combination")) {
    policy.recommended_send_mode = "protected";
  }

  // Recommend a priority fee if missing or too low
  if (triggered.has("missing_execution_params") || triggered.has("large_trade_loose_settings")) {
    policy.recommended_priority_fee_lamports = 10000;
  }

  // Recommend tighter slippage for high price impact (the trade is moving the market)
  if (triggered.has("high_price_impact")) {
    // If slippage recommendation not already set by another rule, set it now
    if (!policy.recommended_slippage_bps) {
      policy.recommended_slippage_bps = trade.slippage_bps > 300 ? 50 : 75;
    }
  }

  return policy;
}

/** Current policy engine version. Bump when rules or decision logic change. */
const POLICY_VERSION = "0.4.0";

/**
 * Run all rules against a validated trade and return the full result.
 *
 * This is the core of Shield402. Everything else is plumbing.
 *
 * Live context is optional — when absent, rules fall back to static checks
 * and confidence stays at "medium".
 */
export function evaluateTrade(
  trade: ValidatedTradeCheck,
  liveContext?: LiveContext,
): TradeCheckResult {
  const ruleResults = allRules.map((rule) => rule.evaluate(trade, liveContext));

  const riskLevel = aggregateRiskLevel(ruleResults);
  const reason = pickReason(ruleResults);
  const recommendation = pickRecommendation(ruleResults, trade);
  const confidence = determineConfidence(liveContext);
  const liveSources = determineLiveSources(liveContext);
  const triggeredRuleIds = ruleResults
    .filter((r) => r.triggered)
    .map((r) => r.rule_id);

  const decision = deriveDecision(riskLevel);
  const policy = buildPolicyRecommendation(riskLevel, triggeredRuleIds, trade);

  return {
    decision,
    policy,
    policy_version: POLICY_VERSION,
    risk_level: riskLevel,
    reason,
    recommendation,
    confidence,
    live_sources: liveSources,
    triggered_rules: triggeredRuleIds,
    rule_details: ruleResults,
  };
}

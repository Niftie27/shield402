import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type {
  RuleResult,
  RiskLevel,
  Confidence,
  PolicyDecision,
  PolicyRecommendation,
  TradeCheckResult,
} from "../types/result";
import type { LiveContext, LiveContextMeta } from "../data/liveContext";
import type { Rule } from "./rule";

import { slippageRule } from "./slippageRule";
import { sendModeRule } from "./sendModeRule";
import { sizeRiskRule } from "./sizeRiskRule";
import { missingFieldsRule } from "./missingFieldsRule";
import { unsafeCombinationRule } from "./unsafeCombinationRule";
import { priceImpactRule } from "./priceImpactRule";
import { tokenSafetyRule } from "./tokenSafetyRule";
import { liquidityDepthRule } from "./liquidityDepthRule";

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
  tokenSafetyRule,
  liquidityDepthRule,
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

    case "token_safety":
      return "Token flagged by safety analysis. Review token safety before trading.";

    case "low_liquidity":
      return "Token has insufficient liquidity for this trade size. Reduce amount or avoid.";

    default:
      return "Review trade parameters before sending.";
  }
}

/**
 * Determine confidence level based on how many live sources succeeded.
 *
 * - No sources attempted (static-only deployment): "medium"
 * - ≥75% of attempted sources succeeded: "high"
 * - ≥25% succeeded: "medium"
 * - <25% succeeded: "low"
 *
 * Falls back to checking LiveContext fields when meta is not provided
 * (backward compatibility for tests that don't pass meta).
 */
function determineConfidence(liveContext?: LiveContext, meta?: LiveContextMeta): Confidence {
  if (meta) {
    if (meta.attempted.length === 0) return "medium"; // no live sources configured
    const ratio = meta.succeeded.length / meta.attempted.length;
    if (ratio >= 0.75) return "high";
    if (ratio >= 0.25) return "medium";
    return "low";
  }

  // Fallback: no meta provided (backward compat)
  if (
    liveContext?.jupiter ||
    liveContext?.rugcheck_input || liveContext?.rugcheck_output ||
    liveContext?.jupiter_shield_input || liveContext?.jupiter_shield_output ||
    liveContext?.jupiter_token_input || liveContext?.jupiter_token_output
  ) return "high";
  return "medium";
}

/**
 * Build provenance array from LiveContextMeta.
 * Each source_detail entry maps directly to one provenance entry.
 */
function buildProvenance(meta?: LiveContextMeta): TradeCheckResult["provenance"] {
  if (!meta) return [];
  return meta.source_detail.map((s) => ({
    source: s.source,
    status: s.status,
    elapsed_ms: s.elapsed_ms,
    fields_used: s.fields_returned,
  }));
}

/**
 * Derive live_sources from provenance (backward compat).
 * Collapses granular IDs (rugcheck:input) to provider-level names (rugcheck).
 * Only includes sources with status "ok" that returned data.
 */
function deriveLiveSources(provenance: TradeCheckResult["provenance"], liveContext?: LiveContext): string[] {
  if (provenance.length > 0) {
    const providers = new Set<string>();
    for (const p of provenance) {
      if (p.status === "ok" && p.fields_used.length > 0) {
        // Collapse to provider-level name: "rugcheck:input" → "rugcheck"
        const provider = p.source.split(":")[0];
        providers.add(provider);
      }
    }
    return Array.from(providers);
  }

  // Fallback: no provenance (backward compat)
  const sources: string[] = [];
  if (liveContext?.jupiter) sources.push("jupiter");
  if (liveContext?.jupiter_shield_input || liveContext?.jupiter_shield_output) sources.push("jupiter-shield");
  if (liveContext?.jupiter_token_input || liveContext?.jupiter_token_output) sources.push("jupiter-tokens");
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

  // Recommend tighter slippage — only if strictly lower than input
  if (triggered.has("slippage_too_wide") || triggered.has("unsafe_combination") || triggered.has("large_trade_loose_settings") || triggered.has("high_price_impact")) {
    const target = trade.slippage_bps > 300 ? 50 : 75;
    if (target < trade.slippage_bps) {
      policy.recommended_slippage_bps = target;
    }
  }

  // Recommend protected send — only if not already protected
  if (triggered.has("unprotected_send_mode") || triggered.has("unsafe_combination")) {
    if (trade.send_mode !== "protected") {
      policy.recommended_send_mode = "protected";
    }
  }

  // Recommend a priority fee — only if higher than provided or missing
  if (triggered.has("missing_execution_params") || triggered.has("large_trade_loose_settings")) {
    const current = trade.priority_fee_lamports ?? 0;
    if (10000 > current) {
      policy.recommended_priority_fee_lamports = 10000;
    }
  }

  return policy;
}

import { VERSION } from "../config/version";
import { getTokenCategory } from "../data/tokenCategory";

/**
 * Critical token safety sources — if any of these were attempted but failed,
 * the assessment is incomplete for token risk and we escalate to at least "warn".
 *
 * Exception: known-safe pairs (both sides stable/major) skip escalation
 * because rugcheck/shield data is low-value for well-established tokens.
 */
const CRITICAL_TOKEN_SOURCES = new Set([
  "rugcheck:input",
  "rugcheck:output",
  "jupiter-shield",
]);

/** Categories where missing token safety data is not alarming. */
const SAFE_CATEGORIES = new Set(["stable", "major"]);

/**
 * Run all rules against a validated trade and return the full result.
 *
 * This is the core of Shield402. Everything else is plumbing.
 *
 * Live context is optional — when absent, rules fall back to static checks
 * and confidence stays at "medium".
 *
 * Meta is optional for backward compatibility (tests that don't provide it).
 * When absent, degraded defaults to false.
 */
export function evaluateTrade(
  trade: ValidatedTradeCheck,
  liveContext?: LiveContext,
  meta?: LiveContextMeta,
): TradeCheckResult {
  const ruleResults = allRules.map((rule) => rule.evaluate(trade, liveContext));

  let riskLevel = aggregateRiskLevel(ruleResults);
  const confidence = determineConfidence(liveContext, meta);
  const provenance = buildProvenance(meta);
  const liveSources = deriveLiveSources(provenance, liveContext);
  const triggeredRuleIds = ruleResults
    .filter((r) => r.triggered)
    .map((r) => r.rule_id);

  // Degraded mode: any attempted source that failed
  const degraded = meta ? meta.failed.length > 0 : false;
  const degraded_reasons = meta
    ? meta.failed.map((f) => ({ source: f.source, status: f.status }))
    : [];

  // Critical safety escalation: if a critical token source was attempted
  // but failed, don't silently default to "allow" — escalate to at least "warn".
  // Exception: known-safe pairs (both sides stable/major) skip escalation.
  let degradedEscalation = false;
  if (meta && riskLevel === "low") {
    const criticalMissing = meta.failed.filter((f) => CRITICAL_TOKEN_SOURCES.has(f.source));
    if (criticalMissing.length > 0) {
      const inputCat = getTokenCategory(trade.input_mint);
      const outputCat = getTokenCategory(trade.output_mint);
      const bothSafe = SAFE_CATEGORIES.has(inputCat) && SAFE_CATEGORIES.has(outputCat);
      if (!bothSafe) {
        riskLevel = "caution";
        degradedEscalation = true;
      }
    }
  }

  // Compute reason/recommendation AFTER escalation so they reflect final riskLevel.
  // When escalated due to degraded critical sources, override with specific messaging.
  const reason = degradedEscalation
    ? `Token safety data unavailable (${meta!.failed.filter((f) => CRITICAL_TOKEN_SOURCES.has(f.source)).map((f) => f.source).join(", ")} failed). Assessment incomplete.`
    : pickReason(ruleResults);
  const recommendation = degradedEscalation
    ? "Retry when token safety sources are available, or proceed with caution."
    : pickRecommendation(ruleResults, trade);

  const decision = deriveDecision(riskLevel);
  const policy = buildPolicyRecommendation(riskLevel, triggeredRuleIds, trade);

  return {
    decision,
    policy,
    policy_version: VERSION,
    risk_level: riskLevel,
    reason,
    recommendation,
    confidence,
    degraded,
    degraded_reasons,
    triggered_rules: triggeredRuleIds,
    live_sources: liveSources,
    provenance,
    rule_details: ruleResults,
  };
}

/**
 * What Shield402 returns to the caller.
 *
 * This is advisory — not a guarantee of protection.
 * The caller decides whether to follow the recommendation.
 */
export type RiskLevel = "low" | "caution" | "high";
export type Confidence = "low" | "medium" | "high";

/**
 * Policy decision — what a bot or agent should do.
 *
 * - "allow"  = trade looks reasonable, proceed
 * - "warn"   = trade has risks, consider adjustments
 * - "block"  = trade is dangerous, do not send as-is
 */
export type PolicyDecision = "allow" | "warn" | "block";

/**
 * Concrete safer parameters the caller can use directly.
 * Only populated when decision is "warn" or "block".
 */
export interface PolicyRecommendation {
  recommended_slippage_bps?: number;
  recommended_send_mode?: "protected";
  recommended_priority_fee_lamports?: number;
}

export interface RuleResult {
  /** Machine-readable rule identifier, e.g. "slippage_too_wide". */
  rule_id: string;

  /** Whether this rule flagged a problem. */
  triggered: boolean;

  /** Severity contribution if triggered. */
  severity: RiskLevel;

  /** Short human-readable explanation. */
  message: string;
}

export interface TradeCheckResult {
  /** Policy decision: allow / warn / block. */
  decision: PolicyDecision;

  /** Concrete safer parameters when decision is warn or block. */
  policy: PolicyRecommendation;

  /** Policy engine version for tracking changes. */
  policy_version: string;

  /** Overall risk assessment. */
  risk_level: RiskLevel;

  /** Plain-English reason for the risk level. */
  reason: string;

  /** One concrete safer action the caller can take. */
  recommendation: string;

  /** How confident the system is in this assessment. */
  confidence: Confidence;

  /** Which rules fired. */
  triggered_rules: string[];

  /** Full rule-by-rule breakdown. Useful for debugging and observability. */
  rule_details: RuleResult[];
}

/**
 * Structured error returned for invalid requests.
 */
export interface TradeCheckError {
  error: string;
  message: string;
  details?: string[];
}

/**
 * Risk configuration — all tunable thresholds live here.
 *
 * These are starting defaults based on common Solana DEX trading patterns.
 * They should be adjusted as we learn from real usage (that's what
 * the observability layer is for).
 */
export const riskConfig = {
  /**
   * Slippage thresholds in basis points.
   * - Below `caution`: considered acceptable
   * - Between `caution` and `high`: flagged as caution
   * - Above `high`: flagged as high risk
   */
  slippage: {
    cautionAboveBps: 100,  // 1%
    highAboveBps: 300,     // 3%
  },

  /**
   * Trade size thresholds in USD-equivalent value.
   * Used for "large trade + loose settings" rule.
   *
   * Note: v1 uses amount_in as a rough proxy. We don't have
   * a price oracle yet, so these are token-amount thresholds
   * that assume SOL ~ $100-200 range. Good enough for v1.
   */
  tradeSize: {
    /** Trades above this are considered "large" for risk purposes. */
    largeThresholdSol: 10,

    /** Trades above this are considered "very large". */
    veryLargeThresholdSol: 50,
  },

  /**
   * Priority fee thresholds in lamports.
   * Suspiciously low fees on large trades can indicate
   * the caller hasn't thought about landing quality.
   */
  priorityFee: {
    /** Below this on a large trade = flag it. */
    lowForLargeTrade: 1000,
  },
} as const;

export type RiskConfig = typeof riskConfig;

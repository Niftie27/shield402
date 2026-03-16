import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { LiveContext } from "../data/liveContext";

/**
 * Every rule implements this interface.
 *
 * A rule inspects a validated trade request and returns a RuleResult.
 * Rules are pure functions — no side effects, no network calls, no state.
 * That makes them easy to test and easy to reason about.
 *
 * Live context is optional — rules that need it check for its presence
 * and fall back to a safe default if it's missing.
 */
export interface Rule {
  /** Unique identifier for this rule. Used in logs and responses. */
  id: string;

  /** Short description for documentation/debugging. */
  description: string;

  /** Evaluate the trade and return a result. */
  evaluate(trade: ValidatedTradeCheck, liveContext?: LiveContext): RuleResult;
}

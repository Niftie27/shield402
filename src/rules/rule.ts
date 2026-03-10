import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";

/**
 * Every rule implements this interface.
 *
 * A rule inspects a validated trade request and returns a RuleResult.
 * Rules are pure functions — no side effects, no network calls, no state.
 * That makes them easy to test and easy to reason about.
 */
export interface Rule {
  /** Unique identifier for this rule. Used in logs and responses. */
  id: string;

  /** Short description for documentation/debugging. */
  description: string;

  /** Evaluate the trade and return a result. */
  evaluate(trade: ValidatedTradeCheck): RuleResult;
}

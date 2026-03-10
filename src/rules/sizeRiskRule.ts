import { riskConfig } from "../config/riskConfig";
import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { Rule } from "./rule";

/**
 * Rule: Large trade with loose settings.
 *
 * A big trade with wide slippage is an attractive sandwich target.
 * The potential profit for a searcher scales with trade size × slippage.
 *
 * v1 uses a simple SOL-amount proxy for "large." This is imprecise
 * (different tokens have different values) but good enough to catch
 * the obvious cases. A price oracle can improve this in v2.
 */
export const sizeRiskRule: Rule = {
  id: "large_trade_loose_settings",
  description: "Flags large trades that have wide slippage or low priority fees.",

  evaluate(trade: ValidatedTradeCheck): RuleResult {
    const { amount_in, amount_in_symbol, slippage_bps, priority_fee_lamports } = trade;
    const { largeThresholdSol, veryLargeThresholdSol } = riskConfig.tradeSize;
    const { cautionAboveBps } = riskConfig.slippage;
    const { lowForLargeTrade } = riskConfig.priorityFee;

    // v1 heuristic: only apply size checks to SOL-denominated trades.
    // For other tokens, we'd need price data we don't have yet.
    const isSolDenominated = amount_in_symbol === "SOL";
    if (!isSolDenominated) {
      return {
        rule_id: this.id,
        triggered: false,
        severity: "low",
        message: "Size risk check only applies to SOL-denominated trades in v1.",
      };
    }

    const isLarge = amount_in >= largeThresholdSol;
    const isVeryLarge = amount_in >= veryLargeThresholdSol;
    const slippageIsWide = slippage_bps > cautionAboveBps;
    const feeIsLow =
      priority_fee_lamports !== undefined &&
      priority_fee_lamports < lowForLargeTrade;

    if (isVeryLarge && slippageIsWide) {
      return {
        rule_id: this.id,
        triggered: true,
        severity: "high",
        message: `Very large trade (${amount_in} SOL) with wide slippage (${slippage_bps} bps). High sandwich risk.`,
      };
    }

    if (isLarge && slippageIsWide) {
      return {
        rule_id: this.id,
        triggered: true,
        severity: "caution",
        message: `Large trade (${amount_in} SOL) with wide slippage (${slippage_bps} bps). Consider tightening.`,
      };
    }

    if (isLarge && feeIsLow) {
      return {
        rule_id: this.id,
        triggered: true,
        severity: "caution",
        message: `Large trade (${amount_in} SOL) with low priority fee (${priority_fee_lamports} lamports). May land slowly.`,
      };
    }

    return {
      rule_id: this.id,
      triggered: false,
      severity: "low",
      message: "Trade size and settings look reasonable.",
    };
  },
};

import { riskConfig } from "../config/riskConfig";
import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { Rule } from "./rule";
import { SOL_MINT } from "../data/mints";

/**
 * Rule: Unsafe combination.
 *
 * This is the "everything is wrong at once" rule. When multiple
 * risk factors stack — large trade + wide slippage + unprotected send —
 * the overall risk is worse than any single factor.
 *
 * This rule only fires when all three conditions are true simultaneously.
 * Individual factors are caught by their own rules.
 */
export const unsafeCombinationRule: Rule = {
  id: "unsafe_combination",
  description: "Flags trades that combine large size, wide slippage, and unprotected send mode.",

  evaluate(trade: ValidatedTradeCheck): RuleResult {
    const { amount_in, input_mint, slippage_bps, send_mode } = trade;
    const { largeThresholdSol } = riskConfig.tradeSize;
    const { cautionAboveBps } = riskConfig.slippage;

    const isSolDenominated = input_mint === SOL_MINT;
    const isLarge = isSolDenominated && amount_in >= largeThresholdSol;
    const slippageIsWide = slippage_bps > cautionAboveBps;
    const isUnprotected = send_mode !== "protected";

    if (isLarge && slippageIsWide && isUnprotected) {
      return {
        rule_id: this.id,
        triggered: true,
        severity: "high",
        message:
          `Dangerous combination: large trade (${amount_in} SOL), ` +
          `wide slippage (${slippage_bps} bps), and ${send_mode} send mode. ` +
          `Strongly recommend tightening slippage and using protected send.`,
      };
    }

    return {
      rule_id: this.id,
      triggered: false,
      severity: "low",
      message: "No unsafe combination detected.",
    };
  },
};

import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import { fetchJupiterQuote, type JupiterQuoteResult } from "./jupiter";
import { fetchRugcheckReport, type RugcheckResult } from "./rugcheck";

/**
 * Live market data fetched before rule evaluation.
 *
 * Each field is optional — if a provider is down or unconfigured,
 * the field is simply missing and rules fall back to static checks.
 *
 * Both input and output tokens are scanned by Rugcheck so that
 * sell-side risk (e.g. selling a scam token into USDC) is also caught.
 */
export interface LiveContext {
  jupiter?: JupiterQuoteResult;
  rugcheck_input?: RugcheckResult;
  rugcheck_output?: RugcheckResult;
}

/**
 * Fetch live market context for a trade.
 *
 * Design principles:
 * - Fail open: if any provider fails, return partial context (never throw)
 * - Short timeout: don't let slow providers block the API
 * - Centralized: all live data fetching happens here, not inside rules
 * - Parallel: independent providers are fetched concurrently
 *
 * When no live data is available, returns an empty object.
 * The rule engine still works — it just uses static checks only.
 */
export async function fetchLiveContext(
  trade: ValidatedTradeCheck,
): Promise<LiveContext> {
  const context: LiveContext = {};

  const hasRugcheckKey = !!process.env.RUGCHECK_API_KEY;

  // Fetch Jupiter + Rugcheck (input & output) in parallel
  const [jupiterResult, rugcheckInputResult, rugcheckOutputResult] = await Promise.allSettled([
    process.env.JUPITER_API_KEY ? fetchJupiterQuote(trade) : null,
    hasRugcheckKey ? fetchRugcheckReport(trade.input_mint) : null,
    hasRugcheckKey ? fetchRugcheckReport(trade.output_mint) : null,
  ]);

  if (jupiterResult.status === "fulfilled" && jupiterResult.value) {
    context.jupiter = jupiterResult.value;
  } else if (jupiterResult.status === "rejected") {
    console.error("Jupiter fetch failed:", jupiterResult.reason);
  }

  if (rugcheckInputResult.status === "fulfilled" && rugcheckInputResult.value) {
    context.rugcheck_input = rugcheckInputResult.value;
  } else if (rugcheckInputResult.status === "rejected") {
    console.error("Rugcheck (input) fetch failed:", rugcheckInputResult.reason);
  }

  if (rugcheckOutputResult.status === "fulfilled" && rugcheckOutputResult.value) {
    context.rugcheck_output = rugcheckOutputResult.value;
  } else if (rugcheckOutputResult.status === "rejected") {
    console.error("Rugcheck (output) fetch failed:", rugcheckOutputResult.reason);
  }

  return context;
}

import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import { fetchJupiterQuote, type JupiterQuoteResult } from "./jupiter";

/**
 * Live market data fetched before rule evaluation.
 *
 * Each field is optional — if a provider is down or unconfigured,
 * the field is simply missing and rules fall back to static checks.
 */
export interface LiveContext {
  jupiter?: JupiterQuoteResult;
}

/**
 * Fetch live market context for a trade.
 *
 * Design principles:
 * - Fail open: if any provider fails, return partial context (never throw)
 * - Short timeout: don't let slow providers block the API
 * - Centralized: all live data fetching happens here, not inside rules
 *
 * When no live data is available, returns an empty object.
 * The rule engine still works — it just uses static checks only.
 */
export async function fetchLiveContext(
  trade: ValidatedTradeCheck,
): Promise<LiveContext> {
  const context: LiveContext = {};

  // Jupiter price impact — only if API key is configured
  if (process.env.JUPITER_API_KEY) {
    try {
      const quote = await fetchJupiterQuote(trade);
      if (quote) {
        context.jupiter = quote;
      }
    } catch (err) {
      // Fail open: log and continue without Jupiter data
      console.error("Jupiter fetch failed:", (err as Error).message);
    }
  }

  return context;
}

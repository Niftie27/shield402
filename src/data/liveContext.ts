import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import { fetchJupiterQuote, type JupiterQuoteResult } from "./jupiter";
import { fetchRugcheckReport, type RugcheckResult } from "./rugcheck";
import { fetchJupiterShield, type JupiterShieldResult } from "./jupiterShield";
import { fetchJupiterToken, type JupiterTokenResult } from "./jupiterTokens";

/**
 * Live market data fetched before rule evaluation.
 *
 * Each field is optional — if a provider is down or unconfigured,
 * the field is simply missing and rules fall back to static checks.
 *
 * Four live data sources:
 * - Jupiter quotes (price impact)
 * - Jupiter Shield (16 structured token warnings)
 * - Jupiter Tokens V2 (liquidity, organic score, audit data)
 * - Rugcheck (token risk scores)
 */
export interface LiveContext {
  jupiter?: JupiterQuoteResult;
  rugcheck_input?: RugcheckResult;
  rugcheck_output?: RugcheckResult;
  jupiter_shield_input?: JupiterShieldResult;
  jupiter_shield_output?: JupiterShieldResult;
  jupiter_token_input?: JupiterTokenResult;
  jupiter_token_output?: JupiterTokenResult;
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

  const hasJupiterKey = !!process.env.JUPITER_API_KEY;
  const hasRugcheckKey = !!process.env.RUGCHECK_API_KEY;

  // Fetch all live data sources in parallel
  const [
    jupiterResult,
    rugcheckInputResult,
    rugcheckOutputResult,
    shieldResult,
    tokenInputResult,
    tokenOutputResult,
  ] = await Promise.allSettled([
    hasJupiterKey ? fetchJupiterQuote(trade) : null,
    hasRugcheckKey ? fetchRugcheckReport(trade.input_mint) : null,
    hasRugcheckKey ? fetchRugcheckReport(trade.output_mint) : null,
    hasJupiterKey ? fetchJupiterShield([trade.input_mint, trade.output_mint]) : null,
    hasJupiterKey ? fetchJupiterToken(trade.input_mint) : null,
    hasJupiterKey ? fetchJupiterToken(trade.output_mint) : null,
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

  // Jupiter Shield — unpack map into input/output fields
  if (shieldResult.status === "fulfilled" && shieldResult.value) {
    const shieldMap = shieldResult.value;
    const inputShield = shieldMap.get(trade.input_mint);
    const outputShield = shieldMap.get(trade.output_mint);
    if (inputShield) context.jupiter_shield_input = inputShield;
    if (outputShield) context.jupiter_shield_output = outputShield;
  } else if (shieldResult.status === "rejected") {
    console.error("Jupiter Shield fetch failed:", shieldResult.reason);
  }

  // Jupiter Tokens V2
  if (tokenInputResult.status === "fulfilled" && tokenInputResult.value) {
    context.jupiter_token_input = tokenInputResult.value;
  } else if (tokenInputResult.status === "rejected") {
    console.error("Jupiter Tokens (input) fetch failed:", tokenInputResult.reason);
  }

  if (tokenOutputResult.status === "fulfilled" && tokenOutputResult.value) {
    context.jupiter_token_output = tokenOutputResult.value;
  } else if (tokenOutputResult.status === "rejected") {
    console.error("Jupiter Tokens (output) fetch failed:", tokenOutputResult.reason);
  }

  return context;
}

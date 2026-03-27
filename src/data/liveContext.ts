import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import { fetchJupiterQuote, type JupiterQuoteResult } from "./jupiter";
import { fetchRugcheckReport, type RugcheckResult } from "./rugcheck";
import { fetchJupiterShield, type JupiterShieldResult } from "./jupiterShield";
import { fetchJupiterToken, type JupiterTokenResult } from "./jupiterTokens";
import { isRealApiKey } from "./apiKeyCheck";

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
 * Per-source tracking of what was attempted, what succeeded, and what failed.
 *
 * This feeds three downstream consumers:
 * - degraded mode (failed sources → degraded: true)
 * - confidence calculation (succeeded/attempted ratio)
 * - provenance (full per-source status in the response)
 */
export interface SourceDetail {
  source: string;
  status: "ok" | "timeout" | "error" | "skipped";
  elapsed_ms: number;
  fields_returned: string[];
}

export interface LiveContextMeta {
  attempted: string[];
  succeeded: string[];
  failed: Array<{ source: string; status: "timeout" | "error" }>;
  source_detail: SourceDetail[];
}

export interface LiveContextResult {
  context: LiveContext;
  meta: LiveContextMeta;
}

/**
 * Fetch live market context for a trade.
 *
 * Design principles:
 * - Fail open: if any provider fails, return partial context (never throw)
 * - Short timeout: don't let slow providers block the API
 * - Centralized: all live data fetching happens here, not inside rules
 * - Parallel: independent providers are fetched concurrently
 * - Observable: returns metadata about what was attempted/succeeded/failed
 *
 * When no live data is available, returns an empty context.
 * The rule engine still works — it just uses static checks only.
 */
export async function fetchLiveContext(
  trade: ValidatedTradeCheck,
): Promise<LiveContextResult> {
  const context: LiveContext = {};
  const sourceDetail: SourceDetail[] = [];

  const hasJupiterKey = isRealApiKey(process.env.JUPITER_API_KEY);

  // Rugcheck works without an API key (public endpoint).
  // Only skip if explicitly disabled via RUGCHECK_DISABLED=true.
  const rugcheckEnabled = process.env.RUGCHECK_DISABLED !== "true";

  // Define all sources with their names and whether they're configured
  const sources = [
    { name: "jupiter", configured: hasJupiterKey },
    { name: "rugcheck:input", configured: rugcheckEnabled },
    { name: "rugcheck:output", configured: rugcheckEnabled },
    { name: "jupiter-shield", configured: hasJupiterKey },
    { name: "jupiter-tokens:input", configured: hasJupiterKey },
    { name: "jupiter-tokens:output", configured: hasJupiterKey },
  ];

  // Record skipped sources (disabled or unconfigured)
  for (const s of sources) {
    if (!s.configured) {
      sourceDetail.push({ source: s.name, status: "skipped", elapsed_ms: 0, fields_returned: [] });
    }
  }

  // Timed fetch wrapper
  async function timedFetch<T>(name: string, fn: () => Promise<T | null>): Promise<{ name: string; value: T | null; elapsed_ms: number }> {
    const start = Date.now();
    try {
      const value = await fn();
      return { name, value, elapsed_ms: Date.now() - start };
    } catch (err) {
      throw { name, elapsed_ms: Date.now() - start, error: err };
    }
  }

  // Build fetch promises (only for configured sources)
  const fetches: Promise<{ name: string; value: unknown; elapsed_ms: number }>[] = [];
  if (hasJupiterKey) fetches.push(timedFetch("jupiter", () => fetchJupiterQuote(trade)));
  if (rugcheckEnabled) fetches.push(timedFetch("rugcheck:input", () => fetchRugcheckReport(trade.input_mint)));
  if (rugcheckEnabled) fetches.push(timedFetch("rugcheck:output", () => fetchRugcheckReport(trade.output_mint)));
  if (hasJupiterKey) fetches.push(timedFetch("jupiter-shield", () => fetchJupiterShield([trade.input_mint, trade.output_mint])));
  if (hasJupiterKey) fetches.push(timedFetch("jupiter-tokens:input", () => fetchJupiterToken(trade.input_mint)));
  if (hasJupiterKey) fetches.push(timedFetch("jupiter-tokens:output", () => fetchJupiterToken(trade.output_mint)));

  const results = await Promise.allSettled(fetches);

  // Process results
  for (const r of results) {
    if (r.status === "fulfilled") {
      const { name, value, elapsed_ms } = r.value;
      if (value == null) {
        // Fetch returned null (provider returned empty/no data)
        sourceDetail.push({ source: name, status: "ok", elapsed_ms, fields_returned: [] });
        continue;
      }

      const fields: string[] = [];

      switch (name) {
        case "jupiter":
          context.jupiter = value as JupiterQuoteResult;
          fields.push("jupiter");
          break;
        case "rugcheck:input":
          context.rugcheck_input = value as RugcheckResult;
          fields.push("rugcheck_input");
          break;
        case "rugcheck:output":
          context.rugcheck_output = value as RugcheckResult;
          fields.push("rugcheck_output");
          break;
        case "jupiter-shield": {
          const shieldMap = value as Map<string, JupiterShieldResult>;
          const inputShield = shieldMap.get(trade.input_mint);
          const outputShield = shieldMap.get(trade.output_mint);
          if (inputShield) { context.jupiter_shield_input = inputShield; fields.push("jupiter_shield_input"); }
          if (outputShield) { context.jupiter_shield_output = outputShield; fields.push("jupiter_shield_output"); }
          break;
        }
        case "jupiter-tokens:input":
          context.jupiter_token_input = value as JupiterTokenResult;
          fields.push("jupiter_token_input");
          break;
        case "jupiter-tokens:output":
          context.jupiter_token_output = value as JupiterTokenResult;
          fields.push("jupiter_token_output");
          break;
      }

      sourceDetail.push({ source: name, status: "ok", elapsed_ms, fields_returned: fields });
    } else {
      // rejected — extract our wrapped error info
      const info = r.reason as { name: string; elapsed_ms: number; error: unknown };
      const isTimeout =
        (info.error instanceof DOMException && info.error.name === "AbortError") ||
        (info.error instanceof Error && info.error.name === "AbortError");
      const status: "timeout" | "error" = isTimeout ? "timeout" : "error";
      const reason = info.error instanceof Error ? info.error.message : String(info.error);
      sourceDetail.push({ source: info.name, status, elapsed_ms: info.elapsed_ms, fields_returned: [] });
      console.error(`${info.name} fetch failed:`, reason);
    }
  }

  // Build meta summary
  const attempted = sourceDetail.filter((s) => s.status !== "skipped").map((s) => s.source);
  const succeeded = sourceDetail.filter((s) => s.status === "ok" && s.fields_returned.length > 0).map((s) => s.source);
  const failed = sourceDetail
    .filter((s): s is SourceDetail & { status: "timeout" | "error" } => s.status === "timeout" || s.status === "error")
    .map((s) => ({
      source: s.source,
      status: s.status as "timeout" | "error",
    }));

  return {
    context,
    meta: { attempted, succeeded, failed, source_detail: sourceDetail },
  };
}

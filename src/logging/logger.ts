import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { TradeCheckResult } from "../types/result";

/**
 * Structured log entry for every request.
 *
 * This is the most important non-obvious part of v1.
 * Static rules alone don't teach us much. But if we log
 * every request + result, we build evidence about:
 *
 * - Which rules fire most often
 * - What trade profiles people actually send
 * - Whether our thresholds are too aggressive or too lenient
 * - What v2 should prioritize
 *
 * v1 logs to stdout as JSON. A future version could write to
 * a file, SQLite, or a remote service.
 */
export interface RequestLog {
  timestamp: string;
  request_id: string;
  trade_summary: {
    chain: string;
    pair: string;
    amount_in: number;
    amount_in_symbol: string;
    slippage_bps: number;
    send_mode: string;
    has_priority_fee: boolean;
    has_route_hint: boolean;
  };
  result_summary: {
    risk_level: string;
    confidence: string;
    triggered_rules: string[];
    rule_count: number;
  };
  duration_ms: number;
}

let requestCounter = 0;

/**
 * Generate a simple request ID.
 * Not cryptographically unique — just enough for log correlation.
 */
export function generateRequestId(): string {
  requestCounter++;
  const ts = Date.now().toString(36);
  return `req_${ts}_${requestCounter.toString().padStart(4, "0")}`;
}

/**
 * Build a structured log entry from the request and result.
 */
export function buildRequestLog(
  requestId: string,
  trade: ValidatedTradeCheck,
  result: TradeCheckResult,
  durationMs: number
): RequestLog {
  return {
    timestamp: new Date().toISOString(),
    request_id: requestId,
    trade_summary: {
      chain: trade.chain,
      pair: trade.pair,
      amount_in: trade.amount_in,
      amount_in_symbol: trade.amount_in_symbol,
      slippage_bps: trade.slippage_bps,
      send_mode: trade.send_mode,
      has_priority_fee: trade.priority_fee_lamports !== undefined,
      has_route_hint: trade.route_hint !== undefined,
    },
    result_summary: {
      risk_level: result.risk_level,
      confidence: result.confidence,
      triggered_rules: result.triggered_rules,
      rule_count: result.triggered_rules.length,
    },
    duration_ms: durationMs,
  };
}

/**
 * Write a log entry to stdout as a single JSON line.
 *
 * This is intentionally simple. JSON lines are easy to:
 * - grep
 * - pipe into jq
 * - load into any analytics tool later
 */
export function logRequest(entry: RequestLog): void {
  console.log(JSON.stringify(entry));
}

/**
 * Log a validation error (bad request).
 */
export function logValidationError(
  requestId: string,
  errors: string[]
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      request_id: requestId,
      event: "validation_error",
      errors,
    })
  );
}

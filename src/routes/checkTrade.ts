import { Request, Response } from "express";
import { tradeCheckSchema } from "../schema/checkTradeSchema";
import { evaluateTrade } from "../rules/index";
import { fetchLiveContext } from "../data/liveContext";
import {
  generateRequestId,
  buildRequestLog,
  logRequest,
  logValidationError,
} from "../logging/logger";

/**
 * POST /check-trade
 *
 * Accepts a proposed Solana trade configuration (mint-based).
 * Fetches live market data (if configured), then runs the rule engine.
 * Returns a risk assessment with decision, reason, and recommendation.
 */
export async function handleCheckTrade(req: Request, res: Response): Promise<void> {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    // 1. Validate request body
    const parsed = tradeCheckSchema.safeParse(req.body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      );

      logValidationError(requestId, errors);

      res.status(400).json({
        error: "invalid_request",
        message: "Request validation failed.",
        details: errors,
      });
      return;
    }

    const trade = parsed.data;

    // 2. Fetch live market data (fails open — returns {} if unavailable)
    const { context: liveContext, meta } = await fetchLiveContext(trade);

    // 3. Run rule engine (synchronous, uses live context if available)
    const result = evaluateTrade(trade, liveContext, meta);

    // 4. Log for observability
    const durationMs = Math.round(performance.now() - startTime);
    const logEntry = buildRequestLog(requestId, trade, result, durationMs);
    logRequest(logEntry);

    // 5. Return result
    res.status(200).json({
      request_id: requestId,
      ...result,
    });
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      request_id: requestId,
      event: "unexpected_error",
      error: err instanceof Error ? err.message : String(err),
      duration_ms: durationMs,
    }));

    res.status(500).json({
      error: "internal_error",
      message: "An unexpected error occurred.",
      request_id: requestId,
    });
  }
}

import { Request, Response } from "express";
import { tradeCheckSchema } from "../schema/checkTradeSchema";
import { evaluateTrade } from "../rules/index";
import {
  generateRequestId,
  buildRequestLog,
  logRequest,
  logValidationError,
} from "../logging/logger";

/**
 * POST /check-trade
 *
 * Accepts a proposed Solana trade configuration.
 * Returns a risk assessment with label, reason, and recommendation.
 *
 * No x402 payment required yet — that wraps this in a later commit.
 */
export function handleCheckTrade(req: Request, res: Response): void {
  const requestId = generateRequestId();
  const startTime = performance.now();

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

  // 2. Run rule engine
  const trade = parsed.data;
  const result = evaluateTrade(trade);

  // 3. Log for observability
  const durationMs = Math.round(performance.now() - startTime);
  const logEntry = buildRequestLog(requestId, trade, result, durationMs);
  logRequest(logEntry);

  // 4. Return result
  res.status(200).json({
    request_id: requestId,
    ...result,
  });
}

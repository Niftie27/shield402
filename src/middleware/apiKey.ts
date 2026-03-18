import { Request, Response, NextFunction } from "express";

/**
 * API key authentication middleware.
 *
 * Checks the X-API-Key header against an allowlist loaded from
 * the API_KEYS environment variable (comma-separated).
 *
 * When API_KEYS is unset or empty, auth is disabled and all
 * requests pass through (same pattern as x402 gating).
 *
 * Authenticated requests get req.authenticated = true, which
 * the rate limiter uses to apply a higher limit.
 */

declare global {
  namespace Express {
    interface Request {
      authenticated?: boolean;
    }
  }
}

function loadApiKeys(): Set<string> {
  const raw = process.env.API_KEYS;
  if (!raw) return new Set();
  return new Set(
    raw.split(",").map((k) => k.trim()).filter((k) => k.length > 0),
  );
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const allowedKeys = loadApiKeys();

  // Auth disabled — pass through
  if (allowedKeys.size === 0) {
    next();
    return;
  }

  const key = req.header("X-API-Key");

  if (key && allowedKeys.has(key)) {
    req.authenticated = true;
    next();
    return;
  }

  res.status(401).json({
    error: "unauthorized",
    message: "Missing or invalid API key. Set the X-API-Key header.",
  });
}

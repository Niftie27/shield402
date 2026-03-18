import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

/**
 * Rate limiting middleware.
 *
 * Two tiers:
 * - Unauthenticated: 20 requests per minute (tight, prevents abuse)
 * - Authenticated (valid API key): 200 requests per minute
 *
 * Uses IP-based keying for unauthenticated requests.
 * Authenticated requests are keyed by their API key so
 * different keys get independent limits.
 *
 * Returns standard 429 with Retry-After header when exceeded.
 */

const WINDOW_MS = 60 * 1000; // 1 minute
const UNAUTH_LIMIT = 20;
const AUTH_LIMIT = 200;

export function createRateLimiter() {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: (req: Request) => (req.authenticated ? AUTH_LIMIT : UNAUTH_LIMIT),
    keyGenerator: (req: Request) => {
      if (req.authenticated) {
        return `key:${req.header("X-API-Key")}`;
      }
      return ipKeyGenerator(req.ip ?? "unknown");
    },
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: "rate_limited",
      message: "Too many requests. Try again later.",
    },
  });
}

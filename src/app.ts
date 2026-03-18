import express from "express";
import { handleCheckTrade } from "./routes/checkTrade";
import { apiKeyAuth } from "./middleware/apiKey";
import { createRateLimiter } from "./middleware/rateLimit";
import type { X402Config } from "./config/x402Config";

export interface AppOptions {
  /** When provided, wraps POST /check-trade with x402 payment middleware. */
  x402?: X402Config | null;
  /** Disable rate limiting (for tests). */
  disableRateLimit?: boolean;
}

/**
 * Create and configure the Express app.
 *
 * Separated from server.ts so the app can be imported
 * directly in tests without starting a real HTTP server.
 *
 * When x402 config is provided, POST /check-trade requires payment.
 * When omitted or null, the endpoint is free.
 */
export function createApp(options: AppOptions = {}) {
  const app = express();

  app.use(express.json());

  // --- API key auth + rate limiting (on /check-trade only) ---
  // Runs before x402 so unauthorized requests are rejected before payment.
  // When API_KEYS is unset, auth is disabled and all requests pass through.
  if (options.disableRateLimit) {
    app.use("/check-trade", apiKeyAuth);
  } else {
    app.use("/check-trade", apiKeyAuth, createRateLimiter());
  }

  // --- x402 payment middleware (conditional) ---

  if (options.x402) {
    const { paymentMiddleware, x402ResourceServer } = require("@x402/express");
    const { ExactSvmScheme } = require("@x402/svm/exact/server");
    const { HTTPFacilitatorClient } = require("@x402/core/server");

    const { svmAddress, facilitatorUrl, network, price } = options.x402;

    const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register(network, new ExactSvmScheme());

    // Only POST /check-trade is payment-gated.
    // GET /health and any other routes pass through free.
    app.use(
      paymentMiddleware(
        {
          "POST /check-trade": {
            accepts: [
              {
                scheme: "exact",
                network,
                payTo: svmAddress,
                price,
              },
            ],
            description: "Solana pre-trade safety check",
            mimeType: "application/json",
          },
        },
        resourceServer,
      ),
    );

    console.log(`x402 payment enabled — ${price} per /check-trade call`);
    console.log(`  network:     ${network}`);
    console.log(`  payTo:       ${svmAddress}`);
    console.log(`  facilitator: ${facilitatorUrl}`);
  }

  // --- Routes ---

  app.post("/check-trade", handleCheckTrade);

  // Health check — always free, never gated
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  return app;
}

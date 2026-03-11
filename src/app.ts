import express from "express";
import { handleCheckTrade } from "./routes/checkTrade";

/**
 * Create and configure the Express app.
 *
 * Separated from server.ts so the app can be imported
 * directly in tests without starting a real HTTP server.
 * This also keeps the door open for adding middleware
 * (like x402) in one place.
 */
export function createApp() {
  const app = express();

  app.use(express.json());

  // --- Routes ---

  app.post("/check-trade", handleCheckTrade);

  // Health check — always free, never gated
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  return app;
}

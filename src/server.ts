import dotenv from "dotenv";
dotenv.config();

import { createApp } from "./app";
import { loadX402Config } from "./config/x402Config";
import { startBot } from "./bot/bot";

const PORT = process.env.PORT || 3402;
const x402 = loadX402Config();
const app = createApp({ x402 });

app.listen(PORT, () => {
  console.log(`Shield402 Lite running on port ${PORT}`);
  console.log(`  API_KEYS configured: ${!!process.env.API_KEYS}`);
  console.log(`  JUPITER_API_KEY configured: ${!!process.env.JUPITER_API_KEY}`);
  console.log(`  SOLANA_RPC_URL configured: ${!!process.env.SOLANA_RPC_URL}`);
  if (!x402) {
    console.log("x402 payment is disabled. Set X402_ENABLED=true in .env to enable.");
  }
});

// Start Telegram bot in the background (non-blocking).
// If TELEGRAM_BOT_TOKEN is not set, this logs a message and returns.
startBot().catch((err) => {
  console.error("Failed to start Telegram bot:", err.message);
});

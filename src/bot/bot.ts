import { Bot } from "grammy";
import { handleStart, handleHelp, handleTradeMessage } from "./handlers";

/**
 * Create and configure the Telegram bot.
 *
 * The bot imports the rule engine directly — it does not call
 * the HTTP API. This keeps it fast and avoids x402 payment
 * for Telegram users in v1.
 *
 * Requires TELEGRAM_BOT_TOKEN in environment.
 */
export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", handleStart);
  bot.command("help", handleHelp);

  // Any non-command text message is treated as a trade check attempt
  bot.on("message:text", handleTradeMessage);

  // Log errors instead of crashing
  bot.catch((err) => {
    console.error("Bot error:", err.message);
  });

  return bot;
}

/**
 * Start the bot with long polling.
 *
 * Call this from server.ts after the API is up.
 * The bot runs in the background and does not block the Express server.
 */
export async function startBot(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.log("Telegram bot is disabled. Set TELEGRAM_BOT_TOKEN in .env to enable.");
    return;
  }

  const bot = createBot(token);

  // Fetch bot info to verify the token works
  await bot.init();
  console.log(`Telegram bot started: @${bot.botInfo.username}`);

  // Start long polling (non-blocking)
  bot.start();
}

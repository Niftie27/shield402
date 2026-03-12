import type { Context } from "grammy";
import { tradeCheckSchema } from "../schema/checkTradeSchema";
import { evaluateTrade } from "../rules/index";
import type { TradeCheckResult } from "../types/result";

const EXAMPLE_JSON = `{
  "chain": "solana",
  "pair": "SOL/USDC",
  "amount_in": 10,
  "amount_in_symbol": "SOL",
  "slippage_bps": 150,
  "send_mode": "standard"
}`;

/** /start command */
export async function handleStart(ctx: Context) {
  await ctx.reply(
    "Shield402 — Solana pre-trade safety checker.\n\n" +
      "Send me a trade config as JSON and I'll tell you if it looks risky.\n\n" +
      "Type /help for the format.",
  );
}

/** /help command */
export async function handleHelp(ctx: Context) {
  await ctx.reply(
    "Send a JSON message with your trade details:\n\n" +
      `<pre>${escapeHtml(EXAMPLE_JSON)}</pre>\n\n` +
      "Required fields:\n" +
      "• chain — must be \"solana\"\n" +
      "• pair — e.g. \"SOL/USDC\"\n" +
      "• amount_in — trade size\n" +
      "• amount_in_symbol — e.g. \"SOL\"\n" +
      "• slippage_bps — slippage in basis points\n" +
      "• send_mode — \"standard\", \"protected\", or \"unknown\"\n\n" +
      "Optional: priority_fee_lamports, route_hint, notes",
    { parse_mode: "HTML" },
  );
}

/** Handle any text message — try to parse as trade JSON */
export async function handleTradeMessage(ctx: Context) {
  const text = ctx.message?.text;
  if (!text) return;

  // Ignore messages that look like commands
  if (text.startsWith("/")) return;

  // Try to parse as JSON
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    await ctx.reply("That doesn't look like JSON. Type /help for the format.");
    return;
  }

  // Validate with Zod schema
  const parsed = tradeCheckSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.errors.map(
      (e) => `• ${e.path.join(".")}: ${e.message}`,
    );
    await ctx.reply(
      "Validation failed:\n\n" + errors.join("\n") + "\n\nType /help for the format.",
    );
    return;
  }

  // Run rule engine
  const result = evaluateTrade(parsed.data);
  await ctx.reply(formatResult(result), { parse_mode: "HTML" });
}

/** Format a TradeCheckResult as a readable Telegram message */
function formatResult(r: TradeCheckResult): string {
  const icon =
    r.risk_level === "high" ? "🔴" :
    r.risk_level === "caution" ? "🟡" :
    "🟢";

  let msg = `${icon} <b>Risk: ${r.risk_level.toUpperCase()}</b>\n\n`;
  msg += `<b>Reason:</b> ${escapeHtml(r.reason)}\n\n`;
  msg += `<b>Recommendation:</b> ${escapeHtml(r.recommendation)}\n`;

  if (r.triggered_rules.length > 0) {
    msg += `\n<b>Triggered rules:</b>\n`;
    for (const rule of r.triggered_rules) {
      msg += `• ${escapeHtml(rule)}\n`;
    }
  }

  msg += `\n<i>Confidence: ${r.confidence} (static rules, no live chain data)</i>`;

  return msg;
}

/** Escape HTML special characters for Telegram HTML parse mode */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

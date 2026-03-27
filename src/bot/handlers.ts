import type { Context } from "grammy";
import { z } from "zod";
import { evaluateTrade } from "../rules/index";
import { fetchLiveContext } from "../data/liveContext";
import { resolveSymbolToMint, isMintAddress } from "../data/mints";
import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { TradeCheckResult } from "../types/result";

/**
 * Bot input schema — user-friendly format with symbol pairs.
 * The bot resolves symbols to mints before calling the policy engine.
 */
const botInputSchema = z.object({
  chain: z.literal("solana", {
    errorMap: () => ({ message: "Only 'solana' is supported." }),
  }),
  pair: z.string().min(3).max(100).refine(
    (s) => s.includes("/") && s.split("/").length === 2 && s.split("/").every((p) => p.trim().length > 0),
    "Pair must be 'INPUT/OUTPUT', e.g. 'SOL/USDC'.",
  ),
  amount_in: z.number().positive("amount_in must be positive."),
  slippage_bps: z.number().int().min(0).max(10000),
  send_mode: z.enum(["standard", "protected", "unknown"]),
  priority_fee_lamports: z.number().int().min(0).optional(),
  route_hint: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

const EXAMPLE_JSON = `{
  "chain": "solana",
  "pair": "SOL/USDC",
  "amount_in": 10,
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
      "• pair — e.g. \"SOL/USDC\" or \"SOL/&lt;mint-address&gt;\"\n" +
      "• amount_in — trade size\n" +
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

  // Validate bot input format
  const parsed = botInputSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.errors.map(
      (e) => `• ${e.path.join(".")}: ${e.message}`,
    );
    await ctx.reply(
      "Validation failed:\n\n" + errors.join("\n") + "\n\nType /help for the format.",
    );
    return;
  }

  // Resolve symbols to mints
  const [inputSymbol, outputSymbol] = parsed.data.pair.split("/").map((s) => s.trim());
  const inputMint = resolveSymbolToMint(inputSymbol);
  const outputMint = resolveSymbolToMint(outputSymbol);

  if (!inputMint) {
    await ctx.reply(`Unknown input token: "${inputSymbol}". Use a known symbol (SOL, USDC, etc.) or a mint address.`);
    return;
  }
  if (!outputMint) {
    await ctx.reply(`Unknown output token: "${outputSymbol}". Use a known symbol (SOL, USDC, etc.) or a mint address.`);
    return;
  }

  // Build the engine's mint-based request
  const trade: ValidatedTradeCheck = {
    chain: "solana",
    input_mint: inputMint,
    output_mint: outputMint,
    amount_in: parsed.data.amount_in,
    slippage_bps: parsed.data.slippage_bps,
    send_mode: parsed.data.send_mode,
    priority_fee_lamports: parsed.data.priority_fee_lamports,
    input_symbol: isMintAddress(inputSymbol) ? undefined : inputSymbol.toUpperCase(),
    output_symbol: isMintAddress(outputSymbol) ? undefined : outputSymbol.toUpperCase(),
    route_hint: parsed.data.route_hint,
    notes: parsed.data.notes,
  };

  // Fetch live data and run rule engine
  const { context: liveContext, meta } = await fetchLiveContext(trade);
  const result = evaluateTrade(trade, liveContext, meta);
  await ctx.reply(formatResult(result), { parse_mode: "HTML" });
}

/** Format a TradeCheckResult as a readable Telegram message */
function formatResult(r: TradeCheckResult): string {
  const icon =
    r.decision === "block" ? "🔴" :
    r.decision === "warn" ? "🟡" :
    "🟢";

  const label =
    r.decision === "block" ? "BLOCK — do not send as-is" :
    r.decision === "warn" ? "WARN — consider adjustments" :
    "ALLOW — proceed normally";

  let msg = `${icon} <b>${label}</b>\n\n`;
  msg += `<b>Reason:</b> ${escapeHtml(r.reason)}\n\n`;
  msg += `<b>Recommendation:</b> ${escapeHtml(r.recommendation)}\n`;

  // Show concrete safer parameters when available
  const p = r.policy;
  if (p.recommended_slippage_bps || p.recommended_send_mode || p.recommended_priority_fee_lamports) {
    msg += `\n<b>Safer parameters:</b>\n`;
    if (p.recommended_slippage_bps) msg += `• slippage: ${p.recommended_slippage_bps} bps\n`;
    if (p.recommended_send_mode) msg += `• send mode: ${p.recommended_send_mode}\n`;
    if (p.recommended_priority_fee_lamports) msg += `• priority fee: ${p.recommended_priority_fee_lamports} lamports\n`;
  }

  if (r.triggered_rules.length > 0) {
    msg += `\n<b>Triggered rules:</b>\n`;
    for (const rule of r.triggered_rules) {
      msg += `• ${escapeHtml(rule)}\n`;
    }
  }

  const sourceNote = r.live_sources.length > 0
    ? `static rules + ${r.live_sources.join(", ")}`
    : "static rules only, no live data";
  msg += `\n<i>Confidence: ${r.confidence} (${sourceNote}) · policy ${r.policy_version}</i>`;

  return msg;
}

/** Escape HTML special characters for Telegram HTML parse mode */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

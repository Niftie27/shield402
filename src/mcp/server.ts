import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { evaluateTrade } from "../rules/index";
import { fetchLiveContext } from "../data/liveContext";
import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import { isMintAddress } from "../data/mints";
import "dotenv/config";

/**
 * Shield402 MCP Server
 *
 * Exposes Shield402's pre-trade safety check as an MCP tool.
 * AI agents can discover and call this tool to check proposed
 * Solana trades before sending transactions.
 *
 * Runs over stdio — designed to be launched by an MCP client
 * (Claude Desktop, agent framework, etc.)
 *
 * Usage:
 *   npx tsx src/mcp/server.ts
 */

const server = new McpServer({
  name: "shield402",
  version: "0.4.0",
});

/**
 * check-trade tool
 *
 * Validates a proposed Solana trade configuration and returns
 * a policy decision (allow/warn/block) with safer parameters.
 */
server.registerTool(
  "check-trade",
  {
    title: "Shield402 Pre-Trade Safety Check",
    description:
      "Check a proposed Solana trade for MEV risk, token safety, and parameter quality. " +
      "Returns a policy decision (allow/warn/block) with recommended safer parameters. " +
      "Call this BEFORE submitting any swap transaction.",
    inputSchema: {
      input_mint: z
        .string()
        .describe("Solana base58 mint address of the input token (e.g. So11111111111111111111111111111111111111112 for SOL)"),
      output_mint: z
        .string()
        .describe("Solana base58 mint address of the output token (e.g. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v for USDC)"),
      amount_in: z
        .number()
        .positive()
        .describe("Amount to trade in human-readable units of the input token"),
      slippage_bps: z
        .number()
        .int()
        .min(0)
        .max(10000)
        .describe("Slippage tolerance in basis points (100 bps = 1%)"),
      send_mode: z
        .enum(["standard", "protected", "unknown"])
        .describe("How the transaction will be sent: 'protected' (Jito/MEV-protected), 'standard' (default RPC), or 'unknown'"),
      priority_fee_lamports: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Priority fee in lamports (optional)"),
      input_symbol: z
        .string()
        .optional()
        .describe("Display symbol for input token, e.g. 'SOL' (optional, not used for resolution)"),
      output_symbol: z
        .string()
        .optional()
        .describe("Display symbol for output token, e.g. 'USDC' (optional, not used for resolution)"),
    },
  },
  async (args) => {
    // Validate mint addresses
    if (!isMintAddress(args.input_mint)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "invalid_request", message: "input_mint is not a valid Solana base58 address." }) }],
        isError: true,
      };
    }
    if (!isMintAddress(args.output_mint)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "invalid_request", message: "output_mint is not a valid Solana base58 address." }) }],
        isError: true,
      };
    }

    const trade: ValidatedTradeCheck = {
      chain: "solana",
      input_mint: args.input_mint,
      output_mint: args.output_mint,
      amount_in: args.amount_in,
      slippage_bps: args.slippage_bps,
      send_mode: args.send_mode,
      priority_fee_lamports: args.priority_fee_lamports,
      input_symbol: args.input_symbol,
      output_symbol: args.output_symbol,
    };

    const liveContext = await fetchLiveContext(trade);
    const result = evaluateTrade(trade, liveContext);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Shield402 MCP server failed to start:", err);
  process.exit(1);
});

import { z } from "zod";

/**
 * Shield402 plugin for solana-agent-kit.
 *
 * Adds a pre-trade safety check action that AI agents can call
 * before executing any swap transaction. The LLM sees this as
 * a tool and can invoke it automatically when the user asks
 * about trading.
 *
 * The plugin calls Shield402's HTTP API, so it works with both
 * local and deployed instances.
 *
 * Usage:
 *   import { Shield402Plugin } from "@shield402/plugin-solana-agent-kit";
 *
 *   const agent = new SolanaAgentKit(wallet, rpcUrl, config)
 *     .use(Shield402Plugin);
 */

const SHIELD402_URL = process.env.SHIELD402_URL ?? "http://localhost:3402";

// -- Types for the Shield402 API response --

interface PolicyRecommendation {
  recommended_slippage_bps?: number;
  recommended_send_mode?: "protected";
  recommended_priority_fee_lamports?: number;
}

interface Shield402Response {
  decision: "allow" | "warn" | "block";
  policy: PolicyRecommendation;
  policy_version: string;
  risk_level: "low" | "caution" | "high";
  reason: string;
  recommendation: string;
  confidence: "low" | "medium" | "high";
  live_sources: string[];
  triggered_rules: string[];
}

// -- Plugin definition --

// Use a structural type so this file doesn't need solana-agent-kit installed.
// The Plugin interface is { name, methods, actions, initialize }.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SolanaAgentKit = any;

interface PluginAction {
  name: string;
  description: string;
  similes: string[];
  examples: Array<{
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    explanation: string;
  }>;
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (agent: SolanaAgentKit, input: Record<string, unknown>) => Promise<unknown>;
}

interface Plugin {
  name: string;
  methods: Record<string, (...args: unknown[]) => unknown>;
  actions: PluginAction[];
  initialize: () => void;
}

/**
 * Call Shield402's /check-trade endpoint.
 */
async function checkTradeSafety(params: {
  input_mint: string;
  output_mint: string;
  amount_in: number;
  slippage_bps: number;
  send_mode: string;
  priority_fee_lamports?: number;
}): Promise<Shield402Response> {
  const response = await fetch(`${SHIELD402_URL}/check-trade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chain: "solana", ...params }),
  });

  if (!response.ok) {
    const error = (await response.json()) as Record<string, unknown>;
    throw new Error(
      `Shield402 rejected request: ${error.message ?? response.statusText}`,
    );
  }

  return response.json() as Promise<Shield402Response>;
}

/**
 * Format a Shield402 response into a readable summary for the LLM.
 */
function formatForLLM(result: Shield402Response): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    decision: result.decision,
    risk_level: result.risk_level,
    reason: result.reason,
    recommendation: result.recommendation,
    confidence: result.confidence,
  };

  // Include safer parameters when available
  if (result.policy.recommended_slippage_bps !== undefined) {
    summary.recommended_slippage_bps = result.policy.recommended_slippage_bps;
  }
  if (result.policy.recommended_send_mode !== undefined) {
    summary.recommended_send_mode = result.policy.recommended_send_mode;
  }
  if (result.policy.recommended_priority_fee_lamports !== undefined) {
    summary.recommended_priority_fee_lamports =
      result.policy.recommended_priority_fee_lamports;
  }

  if (result.triggered_rules.length > 0) {
    summary.triggered_rules = result.triggered_rules;
  }

  if (result.live_sources.length > 0) {
    summary.live_sources = result.live_sources;
  }

  return summary;
}

export const Shield402Plugin: Plugin = {
  name: "Shield402",

  methods: {
    checkTradeSafety: async (
      _agent: SolanaAgentKit,
      input_mint: string,
      output_mint: string,
      amount_in: number,
      slippage_bps: number,
      send_mode: string,
      priority_fee_lamports?: number,
    ) => {
      const result = await checkTradeSafety({
        input_mint,
        output_mint,
        amount_in,
        slippage_bps,
        send_mode,
        priority_fee_lamports,
      });
      return formatForLLM(result);
    },
  },

  actions: [
    {
      name: "check_trade_safety",
      description:
        "Check if a proposed Solana trade is safe before executing. " +
        "Analyzes slippage, trade size, send mode, token risk, and price impact. " +
        "Returns allow/warn/block decision with recommended safer parameters. " +
        "ALWAYS call this before executing a swap.",
      similes: [
        "is this trade safe",
        "check trade safety",
        "should I swap",
        "pre-trade check",
        "check before trading",
        "is this token safe to buy",
        "MEV risk check",
      ],
      examples: [
        {
          input: {
            input_mint: "So11111111111111111111111111111111111111112",
            output_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            amount_in: 2,
            slippage_bps: 50,
            send_mode: "protected",
          },
          output: {
            decision: "allow",
            risk_level: "low",
            reason: "No risk factors detected in this trade configuration.",
            recommendation: "Trade configuration looks reasonable. Proceed normally.",
            confidence: "medium",
          },
          explanation:
            "A small SOL→USDC trade with tight slippage and protected send. No risk factors.",
        },
        {
          input: {
            input_mint: "So11111111111111111111111111111111111111112",
            output_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            amount_in: 60,
            slippage_bps: 500,
            send_mode: "standard",
          },
          output: {
            decision: "block",
            risk_level: "high",
            reason: "Dangerous combination: large trade, wide slippage, unprotected send.",
            recommendation: "Tighten slippage, switch to protected send mode.",
            confidence: "medium",
            recommended_slippage_bps: 50,
            recommended_send_mode: "protected",
          },
          explanation:
            "A large SOL trade with wide slippage and standard send mode. " +
            "Multiple risk factors stack — Shield402 recommends blocking.",
        },
      ],
      schema: z.object({
        input_mint: z
          .string()
          .describe(
            "Solana base58 mint address of the token being sold (e.g. So11111111111111111111111111111111111111112 for SOL)",
          ),
        output_mint: z
          .string()
          .describe(
            "Solana base58 mint address of the token being bought (e.g. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v for USDC)",
          ),
        amount_in: z
          .number()
          .positive()
          .describe("Amount to trade in human-readable units of the input token"),
        slippage_bps: z
          .number()
          .int()
          .min(0)
          .max(10000)
          .describe("Slippage tolerance in basis points (100 = 1%)"),
        send_mode: z
          .enum(["standard", "protected", "unknown"])
          .describe(
            "How the transaction will be sent: 'protected' (Jito/MEV-protected), 'standard' (default RPC), or 'unknown'",
          ),
        priority_fee_lamports: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Priority fee in lamports (optional)"),
      }),
      handler: async (_agent: SolanaAgentKit, input: Record<string, unknown>) => {
        const result = await checkTradeSafety({
          input_mint: input.input_mint as string,
          output_mint: input.output_mint as string,
          amount_in: input.amount_in as number,
          slippage_bps: input.slippage_bps as number,
          send_mode: input.send_mode as string,
          priority_fee_lamports: input.priority_fee_lamports as number | undefined,
        });
        return formatForLLM(result);
      },
    },
  ],

  initialize() {
    // Methods are already bound. No additional setup needed.
  },
};

export default Shield402Plugin;

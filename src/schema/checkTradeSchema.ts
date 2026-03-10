import { z } from "zod";

/**
 * Validates incoming /check-trade requests.
 *
 * Strict in v1: only "solana" chain, only known send modes.
 * Optional fields have sensible defaults or are truly optional.
 */
export const tradeCheckSchema = z.object({
  chain: z
    .literal("solana", {
      errorMap: () => ({ message: "Only 'solana' is supported in v1." }),
    }),

  pair: z
    .string()
    .min(3, "Pair must be at least 3 characters, e.g. 'SOL/USDC'.")
    .max(30),

  amount_in: z
    .number()
    .positive("amount_in must be a positive number."),

  amount_in_symbol: z
    .string()
    .min(1)
    .max(10)
    .transform((s) => s.toUpperCase()),

  slippage_bps: z
    .number()
    .int("slippage_bps must be an integer.")
    .min(0, "slippage_bps cannot be negative.")
    .max(10000, "slippage_bps cannot exceed 10000 (100%)."),

  send_mode: z.enum(["standard", "protected", "unknown"]),

  priority_fee_lamports: z
    .number()
    .int()
    .min(0)
    .optional(),

  route_hint: z
    .string()
    .max(200)
    .optional(),

  notes: z
    .string()
    .max(500)
    .optional(),
});

export type ValidatedTradeCheck = z.infer<typeof tradeCheckSchema>;

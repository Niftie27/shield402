import { z } from "zod";

/**
 * Base58 regex for Solana mint addresses.
 * Solana addresses are 32-44 characters of base58 (no 0, O, I, l).
 */
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Validates incoming /check-trade requests.
 *
 * Mint-based contract: callers provide actual Solana mint addresses.
 * This removes the ambiguity of ticker symbols and ensures the system
 * always checks the correct tokens.
 */
export const tradeCheckSchema = z.object({
  chain: z
    .literal("solana", {
      errorMap: () => ({ message: "Only 'solana' is supported in v1." }),
    }),

  input_mint: z
    .string()
    .regex(base58, "input_mint must be a valid Solana base58 address."),

  output_mint: z
    .string()
    .regex(base58, "output_mint must be a valid Solana base58 address."),

  amount_in: z
    .number()
    .positive("amount_in must be a positive number."),

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

  input_symbol: z
    .string()
    .max(10)
    .optional(),

  output_symbol: z
    .string()
    .max(10)
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

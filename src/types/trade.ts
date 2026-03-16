/**
 * What the caller sends to Shield402.
 *
 * This is a proposed trade configuration — not a signed transaction.
 * The caller is asking: "Is this setup risky, and what should I change?"
 *
 * Mint-based contract: callers provide actual Solana mint addresses,
 * not ambiguous ticker symbols. This ensures the system always checks
 * the correct tokens.
 */
export interface TradeCheckRequest {
  /** Must be "solana" in v1. */
  chain: "solana";

  /** Solana base58 mint address of the input token. */
  input_mint: string;

  /** Solana base58 mint address of the output token. */
  output_mint: string;

  /** Amount to trade, in human-readable units of the input token. */
  amount_in: number;

  /** Slippage tolerance in basis points. 100 bps = 1%. */
  slippage_bps: number;

  /**
   * How the transaction will be sent.
   * - "protected" = using Jito bundles, DontFront, or similar
   * - "standard"  = default RPC send
   * - "unknown"   = caller doesn't know or didn't specify
   */
  send_mode: "standard" | "protected" | "unknown";

  /** Priority fee in lamports. Optional. */
  priority_fee_lamports?: number;

  /** Display symbol for the input token. Optional, never used for resolution. */
  input_symbol?: string;

  /** Display symbol for the output token. Optional, never used for resolution. */
  output_symbol?: string;

  /** Hint about the intended route or venue. Optional. */
  route_hint?: string;

  /** Free-form note from the caller. Optional. */
  notes?: string;
}

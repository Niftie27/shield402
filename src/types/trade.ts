/**
 * What the caller sends to Shield402.
 *
 * This is a proposed trade configuration — not a signed transaction.
 * The caller is asking: "Is this setup risky, and what should I change?"
 */
export interface TradeCheckRequest {
  /** Must be "solana" in v1. */
  chain: "solana";

  /** Trading pair, e.g. "SOL/USDC". */
  pair: string;

  /** Amount to trade, in units of amount_in_symbol. */
  amount_in: number;

  /** Symbol of the input token, e.g. "SOL". */
  amount_in_symbol: string;

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

  /** Hint about the intended route or venue. Optional. */
  route_hint?: string;

  /** Free-form note from the caller. Optional. */
  notes?: string;
}

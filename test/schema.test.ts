import { describe, it, expect } from "vitest";
import { tradeCheckSchema } from "../src/schema/checkTradeSchema";
import { TOKEN_MINTS, SOL_MINT } from "../src/data/mints";

const USDC_MINT = TOKEN_MINTS["USDC"];

describe("schema validation", () => {
  // --- Valid requests ---

  it("accepts a valid full request", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 5,
      slippage_bps: 100,
      send_mode: "protected",
      priority_fee_lamports: 5000,
      input_symbol: "SOL",
      output_symbol: "USDC",
      route_hint: "jupiter",
      notes: "test trade",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a minimal valid request (only required fields)", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 1,
      slippage_bps: 50,
      send_mode: "standard",
    });

    expect(result.success).toBe(true);
  });

  it("accepts any valid base58 mint address", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: SOL_MINT,
      output_mint: "CqfkEoMDz7SVQ8HbKR13bDQjav3jkHPsGK8MZJtPvMz",
      amount_in: 1,
      slippage_bps: 50,
      send_mode: "standard",
    });

    expect(result.success).toBe(true);
  });

  // --- Invalid chain ---

  it("rejects non-solana chains", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "ethereum",
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 5,
      slippage_bps: 100,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  // --- Invalid mint addresses ---

  it("rejects non-base58 input_mint", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: "not-a-valid-mint",
      output_mint: USDC_MINT,
      amount_in: 5,
      slippage_bps: 100,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-base58 output_mint", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: SOL_MINT,
      output_mint: "SOL",
      amount_in: 5,
      slippage_bps: 100,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  it("rejects mint with invalid base58 chars (0, O, I, l)", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: "0O111111111111111111111111111111111111111111",
      output_mint: USDC_MINT,
      amount_in: 5,
      slippage_bps: 100,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  // --- Invalid amount ---

  it("rejects negative amount_in", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: -5,
      slippage_bps: 100,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  it("rejects zero amount_in", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 0,
      slippage_bps: 100,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  // --- Invalid slippage ---

  it("rejects negative slippage", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 5,
      slippage_bps: -10,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  it("rejects slippage above 10000 bps", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 5,
      slippage_bps: 15000,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-integer slippage", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 5,
      slippage_bps: 50.5,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  // --- Invalid send_mode ---

  it("rejects unknown send_mode values", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 5,
      slippage_bps: 50,
      send_mode: "turbo",
    });

    expect(result.success).toBe(false);
  });

  // --- Missing required fields ---

  it("rejects request missing send_mode", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 5,
      slippage_bps: 50,
    });

    expect(result.success).toBe(false);
  });

  it("rejects request missing input_mint", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      output_mint: USDC_MINT,
      amount_in: 5,
      slippage_bps: 50,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty object", () => {
    const result = tradeCheckSchema.safeParse({});

    expect(result.success).toBe(false);
  });
});

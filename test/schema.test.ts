import { describe, it, expect } from "vitest";
import { tradeCheckSchema } from "../src/schema/checkTradeSchema";

describe("schema validation", () => {
  // --- Valid requests ---

  it("accepts a valid full request", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      pair: "SOL/USDC",
      amount_in: 5,
      amount_in_symbol: "SOL",
      slippage_bps: 100,
      send_mode: "protected",
      priority_fee_lamports: 5000,
      route_hint: "jupiter",
      notes: "test trade",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a minimal valid request (only required fields)", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      pair: "SOL/USDC",
      amount_in: 1,
      amount_in_symbol: "SOL",
      slippage_bps: 50,
      send_mode: "standard",
    });

    expect(result.success).toBe(true);
  });

  it("uppercases amount_in_symbol automatically", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      pair: "SOL/USDC",
      amount_in: 1,
      amount_in_symbol: "sol",
      slippage_bps: 50,
      send_mode: "standard",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount_in_symbol).toBe("SOL");
    }
  });

  // --- Invalid chain ---

  it("rejects non-solana chains", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "ethereum",
      pair: "ETH/USDC",
      amount_in: 5,
      amount_in_symbol: "ETH",
      slippage_bps: 100,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  // --- Invalid amount ---

  it("rejects negative amount_in", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      pair: "SOL/USDC",
      amount_in: -5,
      amount_in_symbol: "SOL",
      slippage_bps: 100,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  it("rejects zero amount_in", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      pair: "SOL/USDC",
      amount_in: 0,
      amount_in_symbol: "SOL",
      slippage_bps: 100,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  // --- Invalid slippage ---

  it("rejects negative slippage", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      pair: "SOL/USDC",
      amount_in: 5,
      amount_in_symbol: "SOL",
      slippage_bps: -10,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  it("rejects slippage above 10000 bps", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      pair: "SOL/USDC",
      amount_in: 5,
      amount_in_symbol: "SOL",
      slippage_bps: 15000,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-integer slippage", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      pair: "SOL/USDC",
      amount_in: 5,
      amount_in_symbol: "SOL",
      slippage_bps: 50.5,
      send_mode: "standard",
    });

    expect(result.success).toBe(false);
  });

  // --- Invalid send_mode ---

  it("rejects unknown send_mode values", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      pair: "SOL/USDC",
      amount_in: 5,
      amount_in_symbol: "SOL",
      slippage_bps: 50,
      send_mode: "turbo",
    });

    expect(result.success).toBe(false);
  });

  // --- Missing required fields ---

  it("rejects request missing send_mode", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      pair: "SOL/USDC",
      amount_in: 5,
      amount_in_symbol: "SOL",
      slippage_bps: 50,
    });

    expect(result.success).toBe(false);
  });

  it("rejects request missing amount_in_symbol", () => {
    const result = tradeCheckSchema.safeParse({
      chain: "solana",
      pair: "SOL/USDC",
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

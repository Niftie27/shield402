import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ValidatedTradeCheck } from "../../src/schema/checkTradeSchema";

// Mock the mints module (resolveDecimals)
vi.mock("../../src/data/mints", () => ({
  resolveDecimals: vi.fn(),
}));

import { resolveDecimals } from "../../src/data/mints";
import { fetchJupiterQuote } from "../../src/data/jupiter";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const baseTrade: ValidatedTradeCheck = {
  chain: "solana",
  input_mint: SOL_MINT,
  output_mint: USDC_MINT,
  amount_in: 5,
  slippage_bps: 50,
  send_mode: "protected",
};

/** A valid Jupiter quote API response. */
const validApiResponse = {
  priceImpactPct: "0.12",
  outAmount: "750000000",
  routePlan: [{ id: 1 }, { id: 2 }, { id: 3 }],
};

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

function mockFetchStatus(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  });
}

describe("fetchJupiterQuote", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, JUPITER_API_KEY: "test-key" };
    vi.mocked(resolveDecimals).mockResolvedValue(9); // SOL = 9 decimals
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────
  // Happy path
  // ───────────────────────────────────────────────

  it("returns parsed quote on valid response", async () => {
    globalThis.fetch = mockFetchOk(validApiResponse);

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toEqual({
      priceImpactPct: 0.12,
      outAmount: "750000000",
      routeCount: 3,
    });
  });

  it("sends correct URL parameters and API key header", async () => {
    globalThis.fetch = mockFetchOk(validApiResponse);

    await fetchJupiterQuote(baseTrade);

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    const parsed = new URL(url as string);

    expect(parsed.searchParams.get("inputMint")).toBe(SOL_MINT);
    expect(parsed.searchParams.get("outputMint")).toBe(USDC_MINT);
    // 5 SOL × 10^9 = 5000000000
    expect(parsed.searchParams.get("amount")).toBe("5000000000");
    expect(parsed.searchParams.get("slippageBps")).toBe("50");
    expect((options as RequestInit).headers).toEqual({ "x-api-key": "test-key" });
  });

  it("uses resolved decimals for atomic amount conversion", async () => {
    // Token with 6 decimals (e.g. USDC)
    vi.mocked(resolveDecimals).mockResolvedValue(6);
    globalThis.fetch = mockFetchOk(validApiResponse);

    const usdcTrade = { ...baseTrade, input_mint: USDC_MINT, amount_in: 100 };
    await fetchJupiterQuote(usdcTrade);

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0];
    const parsed = new URL(url as string);
    // 100 × 10^6 = 100000000
    expect(parsed.searchParams.get("amount")).toBe("100000000");
  });

  // ───────────────────────────────────────────────
  // No API key
  // ───────────────────────────────────────────────

  it("returns null when JUPITER_API_KEY is not set", async () => {
    delete process.env.JUPITER_API_KEY;
    globalThis.fetch = vi.fn();

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────
  // Decimals resolution failure
  // ───────────────────────────────────────────────

  it("returns null when decimals cannot be resolved", async () => {
    vi.mocked(resolveDecimals).mockResolvedValue(null);
    globalThis.fetch = vi.fn();

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────
  // Timeout
  // ───────────────────────────────────────────────

  it("returns null when fetch is aborted (timeout)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted", "AbortError"),
    );

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toBeNull();
  });

  // ───────────────────────────────────────────────
  // HTTP errors
  // ───────────────────────────────────────────────

  it("returns null on HTTP 500", async () => {
    globalThis.fetch = mockFetchStatus(500);

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toBeNull();
  });

  it("returns null on HTTP 429 (rate limited)", async () => {
    globalThis.fetch = mockFetchStatus(429);

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toBeNull();
  });

  it("returns null on HTTP 404", async () => {
    globalThis.fetch = mockFetchStatus(404);

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toBeNull();
  });

  // ───────────────────────────────────────────────
  // Malformed JSON
  // ───────────────────────────────────────────────

  it("returns null when response.json() throws (invalid JSON)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token <"); },
    });

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toBeNull();
  });

  // ───────────────────────────────────────────────
  // Missing / malformed fields in response
  // ───────────────────────────────────────────────

  it("returns null when priceImpactPct is not parseable as number", async () => {
    globalThis.fetch = mockFetchOk({
      priceImpactPct: "not-a-number",
      outAmount: "750000000",
      routePlan: [],
    });

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toBeNull();
  });

  it("defaults priceImpactPct to 0 when field is missing", async () => {
    globalThis.fetch = mockFetchOk({
      outAmount: "750000000",
      routePlan: [{ id: 1 }],
    });

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toEqual({
      priceImpactPct: 0,
      outAmount: "750000000",
      routeCount: 1,
    });
  });

  it("defaults outAmount to '0' when field is missing", async () => {
    globalThis.fetch = mockFetchOk({
      priceImpactPct: "0.5",
      routePlan: [],
    });

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toEqual({
      priceImpactPct: 0.5,
      outAmount: "0",
      routeCount: 0,
    });
  });

  it("defaults routeCount to 0 when routePlan is not an array", async () => {
    globalThis.fetch = mockFetchOk({
      priceImpactPct: "1.0",
      outAmount: "500000000",
      routePlan: "invalid",
    });

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toEqual({
      priceImpactPct: 1.0,
      outAmount: "500000000",
      routeCount: 0,
    });
  });

  it("defaults routeCount to 0 when routePlan is missing", async () => {
    globalThis.fetch = mockFetchOk({
      priceImpactPct: "0.01",
      outAmount: "100000",
    });

    const result = await fetchJupiterQuote(baseTrade);

    expect(result?.routeCount).toBe(0);
  });

  it("handles completely empty response body", async () => {
    globalThis.fetch = mockFetchOk({});

    const result = await fetchJupiterQuote(baseTrade);

    // priceImpactPct defaults to parseFloat("0") = 0, which is valid
    expect(result).toEqual({
      priceImpactPct: 0,
      outAmount: "0",
      routeCount: 0,
    });
  });

  // ───────────────────────────────────────────────
  // Network error
  // ───────────────────────────────────────────────

  it("returns null on network error (fetch rejects)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const result = await fetchJupiterQuote(baseTrade);

    expect(result).toBeNull();
  });
});

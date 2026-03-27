import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchJupiterToken } from "../../src/data/jupiterTokens";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const validTokenData = {
  id: SOL_MINT,
  symbol: "SOL",
  isVerified: true,
  organicScore: 95,
  organicScoreLabel: "organic",
  liquidity: 500_000_000,
  holderCount: 1_200_000,
  fdv: 80_000_000_000,
  audit: {
    mintAuthorityDisabled: true,
    freezeAuthorityDisabled: true,
    topHoldersPercentage: 12.5,
    devBalancePercentage: 0.1,
    devMints: 0,
    botHoldersPercentage: 2.3,
  },
  tags: ["verified", "community"],
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

describe("fetchJupiterToken", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, JUPITER_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────
  // Happy path
  // ───────────────────────────────────────────────

  it("returns parsed token data on valid response", async () => {
    globalThis.fetch = mockFetchOk([validTokenData]);

    const result = await fetchJupiterToken(SOL_MINT);

    expect(result).toEqual({
      mint: SOL_MINT,
      symbol: "SOL",
      isVerified: true,
      organicScore: 95,
      organicScoreLabel: "organic",
      liquidity: 500_000_000,
      holderCount: 1_200_000,
      fdv: 80_000_000_000,
      audit: validTokenData.audit,
      tags: ["verified", "community"],
    });
  });

  it("sends correct URL with query param and API key header", async () => {
    globalThis.fetch = mockFetchOk([validTokenData]);

    await fetchJupiterToken(SOL_MINT);

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toContain(`query=${SOL_MINT}`);
    expect((options as RequestInit).headers).toEqual({ "x-api-key": "test-key" });
  });

  it("matches by 'id' field", async () => {
    globalThis.fetch = mockFetchOk([{ id: SOL_MINT, symbol: "SOL" }]);

    const result = await fetchJupiterToken(SOL_MINT);

    expect(result!.mint).toBe(SOL_MINT);
    expect(result!.symbol).toBe("SOL");
  });

  it("matches by 'address' field when 'id' is absent", async () => {
    globalThis.fetch = mockFetchOk([{ address: SOL_MINT, symbol: "SOL" }]);

    const result = await fetchJupiterToken(SOL_MINT);

    expect(result!.mint).toBe(SOL_MINT);
  });

  it("matches by 'mint' field when 'id' and 'address' are absent", async () => {
    globalThis.fetch = mockFetchOk([{ mint: SOL_MINT, symbol: "SOL" }]);

    const result = await fetchJupiterToken(SOL_MINT);

    expect(result!.mint).toBe(SOL_MINT);
  });

  it("picks exact mint match from multiple search results", async () => {
    globalThis.fetch = mockFetchOk([
      { id: BONK_MINT, symbol: "BONK", liquidity: 1000 },
      { id: SOL_MINT, symbol: "SOL", liquidity: 500_000_000 },
    ]);

    const result = await fetchJupiterToken(SOL_MINT);

    expect(result!.symbol).toBe("SOL");
    expect(result!.liquidity).toBe(500_000_000);
  });

  // ───────────────────────────────────────────────
  // No API key
  // ───────────────────────────────────────────────

  it("returns null when JUPITER_API_KEY is not set", async () => {
    delete process.env.JUPITER_API_KEY;
    globalThis.fetch = vi.fn();

    const result = await fetchJupiterToken(SOL_MINT);

    expect(result).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────
  // Timeout
  // ───────────────────────────────────────────────

  it("throws when fetch is aborted (timeout)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted", "AbortError"),
    );

    await expect(fetchJupiterToken(SOL_MINT)).rejects.toThrow();
  });

  // ───────────────────────────────────────────────
  // HTTP errors
  // ───────────────────────────────────────────────

  it("throws on HTTP 500", async () => {
    globalThis.fetch = mockFetchStatus(500);

    await expect(fetchJupiterToken(SOL_MINT)).rejects.toThrow("HTTP 500");
  });

  it("throws on HTTP 429", async () => {
    globalThis.fetch = mockFetchStatus(429);

    await expect(fetchJupiterToken(SOL_MINT)).rejects.toThrow("HTTP 429");
  });

  // ───────────────────────────────────────────────
  // Malformed responses
  // ───────────────────────────────────────────────

  it("throws when response.json() throws", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token <"); },
    });

    await expect(fetchJupiterToken(SOL_MINT)).rejects.toThrow("Unexpected token");
  });

  it("returns null when response is not an array", async () => {
    globalThis.fetch = mockFetchOk({ data: "not an array" });

    const result = await fetchJupiterToken(SOL_MINT);

    expect(result).toBeNull();
  });

  it("returns null when response is an empty array", async () => {
    globalThis.fetch = mockFetchOk([]);

    const result = await fetchJupiterToken(SOL_MINT);

    expect(result).toBeNull();
  });

  it("returns null when no result matches the requested mint", async () => {
    globalThis.fetch = mockFetchOk([
      { id: BONK_MINT, symbol: "BONK" },
    ]);

    const result = await fetchJupiterToken(SOL_MINT);

    expect(result).toBeNull();
  });

  // ───────────────────────────────────────────────
  // Missing optional fields
  // ───────────────────────────────────────────────

  it("handles token with minimal fields (only id)", async () => {
    globalThis.fetch = mockFetchOk([{ id: SOL_MINT }]);

    const result = await fetchJupiterToken(SOL_MINT);

    expect(result).toEqual({
      mint: SOL_MINT,
      symbol: undefined,
      isVerified: undefined,
      organicScore: undefined,
      organicScoreLabel: undefined,
      liquidity: undefined,
      holderCount: undefined,
      fdv: undefined,
      audit: undefined,
      tags: undefined,
    });
  });

  // ───────────────────────────────────────────────
  // Network error
  // ───────────────────────────────────────────────

  it("throws on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(fetchJupiterToken(SOL_MINT)).rejects.toThrow("fetch failed");
  });
});

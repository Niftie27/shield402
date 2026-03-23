import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchMintDecimals, clearDecimalsCache } from "../../src/data/solana";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

/**
 * Build a valid base64-encoded SPL Mint account (82 bytes).
 * Byte 44 = decimals.
 */
function buildMintAccountBase64(decimals: number): string {
  const buffer = Buffer.alloc(82, 0);
  buffer[44] = decimals;
  buffer[45] = 1; // is_initialized = true
  return buffer.toString("base64");
}

function mockRpcOk(data: [string, string] | null) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      jsonrpc: "2.0",
      id: 1,
      result: { value: data ? { data } : null },
    }),
  });
}

function mockRpcStatus(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  });
}

describe("fetchMintDecimals", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, SOLANA_RPC_URL: "https://rpc.test" };
    clearDecimalsCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────
  // Happy path
  // ───────────────────────────────────────────────

  it("returns decimals from valid mint account (9 decimals)", async () => {
    globalThis.fetch = mockRpcOk([buildMintAccountBase64(9), "base64"]);

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBe(9);
  });

  it("returns decimals from valid mint account (6 decimals)", async () => {
    globalThis.fetch = mockRpcOk([buildMintAccountBase64(6), "base64"]);

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBe(6);
  });

  it("returns 0 decimals for tokens with no decimal places", async () => {
    globalThis.fetch = mockRpcOk([buildMintAccountBase64(0), "base64"]);

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBe(0);
  });

  it("sends correct RPC request body", async () => {
    globalThis.fetch = mockRpcOk([buildMintAccountBase64(9), "base64"]);

    await fetchMintDecimals(SOL_MINT);

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("https://rpc.test");

    const body = JSON.parse((options as RequestInit).body as string);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [SOL_MINT, { encoding: "base64" }],
    });
  });

  // ───────────────────────────────────────────────
  // Cache
  // ───────────────────────────────────────────────

  it("returns cached value on second call without fetching", async () => {
    globalThis.fetch = mockRpcOk([buildMintAccountBase64(9), "base64"]);

    const first = await fetchMintDecimals(SOL_MINT);
    const second = await fetchMintDecimals(SOL_MINT);

    expect(first).toBe(9);
    expect(second).toBe(9);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("caches different mints independently", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0", id: 1,
          result: { value: { data: [buildMintAccountBase64(9), "base64"] } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0", id: 1,
          result: { value: { data: [buildMintAccountBase64(5), "base64"] } },
        }),
      });

    const sol = await fetchMintDecimals(SOL_MINT);
    const bonk = await fetchMintDecimals(BONK_MINT);

    expect(sol).toBe(9);
    expect(bonk).toBe(5);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("clearDecimalsCache forces re-fetch", async () => {
    globalThis.fetch = mockRpcOk([buildMintAccountBase64(9), "base64"]);

    await fetchMintDecimals(SOL_MINT);
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    clearDecimalsCache();

    globalThis.fetch = mockRpcOk([buildMintAccountBase64(9), "base64"]);
    await fetchMintDecimals(SOL_MINT);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  // ───────────────────────────────────────────────
  // No RPC URL
  // ───────────────────────────────────────────────

  it("returns null when SOLANA_RPC_URL is not set", async () => {
    delete process.env.SOLANA_RPC_URL;
    globalThis.fetch = vi.fn();

    const result = await fetchMintDecimals(SOL_MINT);

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

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBeNull();
  });

  // ───────────────────────────────────────────────
  // HTTP errors
  // ───────────────────────────────────────────────

  it("returns null on HTTP 500", async () => {
    globalThis.fetch = mockRpcStatus(500);

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBeNull();
  });

  it("returns null on HTTP 429", async () => {
    globalThis.fetch = mockRpcStatus(429);

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBeNull();
  });

  // ───────────────────────────────────────────────
  // Malformed RPC responses
  // ───────────────────────────────────────────────

  it("returns null when response.json() throws", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    });

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBeNull();
  });

  it("returns null when account does not exist (value is null)", async () => {
    globalThis.fetch = mockRpcOk(null);

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBeNull();
  });

  it("returns null when data encoding is not base64", async () => {
    globalThis.fetch = mockRpcOk([buildMintAccountBase64(9), "jsonParsed"]);

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBeNull();
  });

  it("returns null when data field is missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0", id: 1,
        result: { value: {} },
      }),
    });

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBeNull();
  });

  it("returns null when result field is missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1 }),
    });

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBeNull();
  });

  // ───────────────────────────────────────────────
  // Invalid account data
  // ───────────────────────────────────────────────

  it("returns null when buffer is too short (<45 bytes)", async () => {
    const shortBuffer = Buffer.alloc(30, 0).toString("base64");
    globalThis.fetch = mockRpcOk([shortBuffer, "base64"]);

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBeNull();
  });

  it("returns null when decimals exceeds 18 (sanity check)", async () => {
    globalThis.fetch = mockRpcOk([buildMintAccountBase64(19), "base64"]);

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBeNull();
  });

  it("accepts decimals of exactly 18", async () => {
    globalThis.fetch = mockRpcOk([buildMintAccountBase64(18), "base64"]);

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBe(18);
  });

  // ───────────────────────────────────────────────
  // Network error
  // ───────────────────────────────────────────────

  it("returns null on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const result = await fetchMintDecimals(SOL_MINT);

    expect(result).toBeNull();
  });

  // ───────────────────────────────────────────────
  // Does not cache failures
  // ───────────────────────────────────────────────

  it("does not cache null results — retries on next call", async () => {
    // First call fails
    globalThis.fetch = mockRpcStatus(500);
    const first = await fetchMintDecimals(SOL_MINT);
    expect(first).toBeNull();

    // Second call succeeds
    globalThis.fetch = mockRpcOk([buildMintAccountBase64(9), "base64"]);
    const second = await fetchMintDecimals(SOL_MINT);
    expect(second).toBe(9);
  });
});

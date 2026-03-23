import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchJupiterShield } from "../../src/data/jupiterShield";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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

describe("fetchJupiterShield", () => {
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

  it("returns map with warnings for both mints", async () => {
    globalThis.fetch = mockFetchOk({
      warnings: {
        [SOL_MINT]: [],
        [USDC_MINT]: [
          { type: "HAS_FREEZE_AUTHORITY", message: "Can freeze", severity: "warning" },
        ],
      },
    });

    const result = await fetchJupiterShield([SOL_MINT, USDC_MINT]);

    expect(result).toBeInstanceOf(Map);
    expect(result!.size).toBe(2);
    expect(result!.get(SOL_MINT)).toEqual({ mint: SOL_MINT, warnings: [] });
    expect(result!.get(USDC_MINT)).toEqual({
      mint: USDC_MINT,
      warnings: [{ type: "HAS_FREEZE_AUTHORITY", message: "Can freeze", severity: "warning" }],
    });
  });

  it("sends correct URL with comma-separated mints and API key header", async () => {
    globalThis.fetch = mockFetchOk({ warnings: {} });

    await fetchJupiterShield([SOL_MINT, USDC_MINT]);

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toContain(`mints=${SOL_MINT},${USDC_MINT}`);
    expect((options as RequestInit).headers).toEqual({ "x-api-key": "test-key" });
  });

  it("works with a single mint", async () => {
    globalThis.fetch = mockFetchOk({
      warnings: {
        [SOL_MINT]: [{ type: "NOT_VERIFIED", message: "Unverified", severity: "info" }],
      },
    });

    const result = await fetchJupiterShield([SOL_MINT]);

    expect(result!.size).toBe(1);
    expect(result!.get(SOL_MINT)!.warnings).toHaveLength(1);
  });

  it("returns map with empty warnings for clean tokens", async () => {
    globalThis.fetch = mockFetchOk({
      warnings: { [SOL_MINT]: [] },
    });

    const result = await fetchJupiterShield([SOL_MINT]);

    expect(result!.get(SOL_MINT)).toEqual({ mint: SOL_MINT, warnings: [] });
  });

  // ───────────────────────────────────────────────
  // No API key / empty mints
  // ───────────────────────────────────────────────

  it("returns null when JUPITER_API_KEY is not set", async () => {
    delete process.env.JUPITER_API_KEY;
    globalThis.fetch = vi.fn();

    const result = await fetchJupiterShield([SOL_MINT]);

    expect(result).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns null when mints array is empty", async () => {
    globalThis.fetch = vi.fn();

    const result = await fetchJupiterShield([]);

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

    const result = await fetchJupiterShield([SOL_MINT]);

    expect(result).toBeNull();
  });

  // ───────────────────────────────────────────────
  // HTTP errors
  // ───────────────────────────────────────────────

  it("returns null on HTTP 500", async () => {
    globalThis.fetch = mockFetchStatus(500);

    const result = await fetchJupiterShield([SOL_MINT]);

    expect(result).toBeNull();
  });

  it("returns null on HTTP 429", async () => {
    globalThis.fetch = mockFetchStatus(429);

    const result = await fetchJupiterShield([SOL_MINT]);

    expect(result).toBeNull();
  });

  // ───────────────────────────────────────────────
  // Malformed responses
  // ───────────────────────────────────────────────

  it("returns null when response.json() throws", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token <"); },
    });

    const result = await fetchJupiterShield([SOL_MINT]);

    expect(result).toBeNull();
  });

  it("returns null when response has no warnings field", async () => {
    globalThis.fetch = mockFetchOk({ data: "something else" });

    const result = await fetchJupiterShield([SOL_MINT]);

    expect(result).toBeNull();
  });

  it("returns null when warnings is null", async () => {
    globalThis.fetch = mockFetchOk({ warnings: null });

    const result = await fetchJupiterShield([SOL_MINT]);

    expect(result).toBeNull();
  });

  it("returns empty map when warnings object is empty", async () => {
    globalThis.fetch = mockFetchOk({ warnings: {} });

    const result = await fetchJupiterShield([SOL_MINT]);

    expect(result).toBeInstanceOf(Map);
    expect(result!.size).toBe(0);
  });

  it("handles warnings with null array for a mint (defaults to empty)", async () => {
    globalThis.fetch = mockFetchOk({
      warnings: { [SOL_MINT]: null },
    });

    const result = await fetchJupiterShield([SOL_MINT]);

    expect(result!.get(SOL_MINT)).toEqual({ mint: SOL_MINT, warnings: [] });
  });

  // ───────────────────────────────────────────────
  // Network error
  // ───────────────────────────────────────────────

  it("returns null on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const result = await fetchJupiterShield([SOL_MINT]);

    expect(result).toBeNull();
  });
});

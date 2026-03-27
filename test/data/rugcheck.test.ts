import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchRugcheckReport } from "../../src/data/rugcheck";

const SOL_MINT = "So11111111111111111111111111111111111111112";

const validApiResponse = {
  score: 4500,           // raw additive total (can be >>100)
  score_normalised: 45,  // normalized 0-100 (what Rugcheck shows to humans)
  risks: [
    { name: "Low liquidity", level: "warn", description: "Pool is thin", score: 20 },
    { name: "Mutable metadata", level: "info", description: "Metadata can change", score: 10 },
    { name: "Large holder", level: "warn", description: "Top holder >10%", score: 15 },
  ],
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

describe("fetchRugcheckReport", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, RUGCHECK_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────
  // Happy path
  // ───────────────────────────────────────────────

  it("returns parsed report using score_normalised as primary score", async () => {
    globalThis.fetch = mockFetchOk(validApiResponse);

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result!.score).toBe(45);       // normalized, not 4500
    expect(result!.scoreRaw).toBe(4500);  // raw kept for debug
    expect(result!.risks).toEqual([
      { name: "Low liquidity", level: "warn", description: "Pool is thin", score: 20 },
      { name: "Mutable metadata", level: "info", description: "Metadata can change", score: 10 },
      { name: "Large holder", level: "warn", description: "Top holder >10%", score: 15 },
    ]);
  });

  it("sends correct URL with mint and API key header", async () => {
    globalThis.fetch = mockFetchOk(validApiResponse);

    await fetchRugcheckReport(SOL_MINT);

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toContain(`/tokens/${SOL_MINT}/report/summary`);
    const headers = (options as RequestInit).headers as Record<string, string>;
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["X-API-KEY"]).toBe("test-key");
  });

  it("keeps only top 5 risks", async () => {
    const manyRisks = Array.from({ length: 8 }, (_, i) => ({
      name: `Risk ${i}`,
      level: "warn",
      description: `Desc ${i}`,
      score: i * 5,
    }));
    globalThis.fetch = mockFetchOk({ score: 60, risks: manyRisks });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result!.risks).toHaveLength(5);
    expect(result!.risks[0].name).toBe("Risk 0");
    expect(result!.risks[4].name).toBe("Risk 4");
  });

  it("returns empty risks array for clean token", async () => {
    globalThis.fetch = mockFetchOk({ score: 0, score_normalised: 0, risks: [] });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result!.score).toBe(0);
    expect(result!.risks).toEqual([]);
  });

  // ───────────────────────────────────────────────
  // No API key — still fetches (public endpoint)
  // ───────────────────────────────────────────────

  it("fetches without API key header when RUGCHECK_API_KEY is not set", async () => {
    delete process.env.RUGCHECK_API_KEY;
    globalThis.fetch = mockFetchOk(validApiResponse);

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).not.toBeNull();
    expect(result!.score).toBe(45);
    const [, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = (options as RequestInit).headers as Record<string, string>;
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["X-API-KEY"]).toBeUndefined();
  });

  it("falls back to raw score when score_normalised is missing", async () => {
    globalThis.fetch = mockFetchOk({ score: 30, risks: [] });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result!.score).toBe(30);       // falls back to raw
    expect(result!.scoreRaw).toBe(30);
  });

  it("prefers score_normalised over raw score for policy decisions", async () => {
    // BONK-like: raw=101 would block, normalized=7 should not
    globalThis.fetch = mockFetchOk({ score: 101, score_normalised: 7, risks: [] });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result!.score).toBe(7);        // normalized wins
    expect(result!.scoreRaw).toBe(101);   // raw preserved
  });

  it("returns null when neither score nor score_normalised is present", async () => {
    globalThis.fetch = mockFetchOk({ risks: [] });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toBeNull();
  });

  it("does not send placeholder API key as header", async () => {
    process.env.RUGCHECK_API_KEY = "<YOUR-RUGCHECK-API-KEY>";
    globalThis.fetch = mockFetchOk(validApiResponse);

    await fetchRugcheckReport(SOL_MINT);

    const [, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = (options as RequestInit).headers as Record<string, string>;
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["X-API-KEY"]).toBeUndefined();
  });

  // ───────────────────────────────────────────────
  // Extended fields
  // ───────────────────────────────────────────────

  it("parses extended fields when present", async () => {
    globalThis.fetch = mockFetchOk({
      score: 30,
      risks: [],
      riskLevel: "warn",
      mintAuthority: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
      freezeAuthority: null,
      lpLocked: true,
      lpLockedPct: 85.5,
      topHoldersPct: 12.3,
    });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result!.riskLevel).toBe("warn");
    expect(result!.mintAuthority).toBe("5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1");
    expect(result!.freezeAuthority).toBeNull();
    expect(result!.lpLocked).toBe(true);
    expect(result!.lpLockedPct).toBe(85.5);
    expect(result!.topHoldersPct).toBe(12.3);
  });

  it("omits extended fields when not in response", async () => {
    globalThis.fetch = mockFetchOk({ score: 10, risks: [] });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result!.riskLevel).toBeUndefined();
    expect(result!.mintAuthority).toBeUndefined();
    expect(result!.freezeAuthority).toBeUndefined();
    expect(result!.lpLocked).toBeUndefined();
    expect(result!.lpLockedPct).toBeUndefined();
    expect(result!.topHoldersPct).toBeUndefined();
  });

  // ───────────────────────────────────────────────
  // Timeout
  // ───────────────────────────────────────────────

  it("throws when fetch is aborted (timeout)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted", "AbortError"),
    );

    await expect(fetchRugcheckReport(SOL_MINT)).rejects.toThrow();
  });

  // ───────────────────────────────────────────────
  // HTTP errors — throw so callers detect degraded state
  // ───────────────────────────────────────────────

  it("throws on HTTP 500", async () => {
    globalThis.fetch = mockFetchStatus(500);

    await expect(fetchRugcheckReport(SOL_MINT)).rejects.toThrow("HTTP 500");
  });

  it("throws on HTTP 429", async () => {
    globalThis.fetch = mockFetchStatus(429);

    await expect(fetchRugcheckReport(SOL_MINT)).rejects.toThrow("HTTP 429");
  });

  it("throws on HTTP 404", async () => {
    globalThis.fetch = mockFetchStatus(404);

    await expect(fetchRugcheckReport(SOL_MINT)).rejects.toThrow("HTTP 404");
  });

  // ───────────────────────────────────────────────
  // Malformed responses — throw (transport-level failure)
  // ───────────────────────────────────────────────

  it("throws when response.json() throws", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token <"); },
    });

    await expect(fetchRugcheckReport(SOL_MINT)).rejects.toThrow("Unexpected token");
  });

  it("returns null when score is not a number", async () => {
    globalThis.fetch = mockFetchOk({ score: "high", risks: [] });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toBeNull();
  });

  it("defaults risks to empty array when field is missing", async () => {
    globalThis.fetch = mockFetchOk({ score: 10 });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result!.score).toBe(10);
    expect(result!.risks).toEqual([]);
  });

  it("defaults risks to empty array when field is not an array", async () => {
    globalThis.fetch = mockFetchOk({ score: 10, risks: "invalid" });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result!.score).toBe(10);
    expect(result!.risks).toEqual([]);
  });

  it("filters out malformed risk entries without 'name'", async () => {
    globalThis.fetch = mockFetchOk({
      score: 30,
      risks: [
        { name: "Valid risk", level: "warn", description: "ok", score: 10 },
        { level: "warn", description: "no name field", score: 5 },
        null,
        42,
      ],
    });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result!.risks).toHaveLength(1);
    expect(result!.risks[0].name).toBe("Valid risk");
  });

  it("defaults missing risk sub-fields to safe values", async () => {
    globalThis.fetch = mockFetchOk({
      score: 20,
      risks: [{ name: "Bare risk" }],
    });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result!.risks[0]).toEqual({
      name: "Bare risk",
      level: "",
      description: "",
      score: 0,
    });
  });

  // ───────────────────────────────────────────────
  // Network error
  // ───────────────────────────────────────────────

  it("throws on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(fetchRugcheckReport(SOL_MINT)).rejects.toThrow("fetch failed");
  });
});

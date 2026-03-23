import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchRugcheckReport } from "../../src/data/rugcheck";

const SOL_MINT = "So11111111111111111111111111111111111111112";

const validApiResponse = {
  score: 45,
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

  it("returns parsed report on valid response", async () => {
    globalThis.fetch = mockFetchOk(validApiResponse);

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toEqual({
      score: 45,
      risks: [
        { name: "Low liquidity", level: "warn", description: "Pool is thin", score: 20 },
        { name: "Mutable metadata", level: "info", description: "Metadata can change", score: 10 },
        { name: "Large holder", level: "warn", description: "Top holder >10%", score: 15 },
      ],
    });
  });

  it("sends correct URL with mint and API key header", async () => {
    globalThis.fetch = mockFetchOk(validApiResponse);

    await fetchRugcheckReport(SOL_MINT);

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toContain(`/tokens/${SOL_MINT}/report/summary`);
    expect((options as RequestInit).headers).toEqual({ "X-API-KEY": "test-key" });
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
    globalThis.fetch = mockFetchOk({ score: 0, risks: [] });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toEqual({ score: 0, risks: [] });
  });

  // ───────────────────────────────────────────────
  // No API key
  // ───────────────────────────────────────────────

  it("returns null when RUGCHECK_API_KEY is not set", async () => {
    delete process.env.RUGCHECK_API_KEY;
    globalThis.fetch = vi.fn();

    const result = await fetchRugcheckReport(SOL_MINT);

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

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toBeNull();
  });

  // ───────────────────────────────────────────────
  // HTTP errors
  // ───────────────────────────────────────────────

  it("returns null on HTTP 500", async () => {
    globalThis.fetch = mockFetchStatus(500);

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toBeNull();
  });

  it("returns null on HTTP 429", async () => {
    globalThis.fetch = mockFetchStatus(429);

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toBeNull();
  });

  it("returns null on HTTP 404", async () => {
    globalThis.fetch = mockFetchStatus(404);

    const result = await fetchRugcheckReport(SOL_MINT);

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

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toBeNull();
  });

  it("returns null when score is not a number", async () => {
    globalThis.fetch = mockFetchOk({ score: "high", risks: [] });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toBeNull();
  });

  it("returns null when score is missing", async () => {
    globalThis.fetch = mockFetchOk({ risks: [] });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toBeNull();
  });

  it("defaults risks to empty array when field is missing", async () => {
    globalThis.fetch = mockFetchOk({ score: 10 });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toEqual({ score: 10, risks: [] });
  });

  it("defaults risks to empty array when field is not an array", async () => {
    globalThis.fetch = mockFetchOk({ score: 10, risks: "invalid" });

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toEqual({ score: 10, risks: [] });
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

  it("returns null on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const result = await fetchRugcheckReport(SOL_MINT);

    expect(result).toBeNull();
  });
});

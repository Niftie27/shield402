import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ValidatedTradeCheck } from "../../src/schema/checkTradeSchema";
import type { JupiterQuoteResult } from "../../src/data/jupiter";
import type { RugcheckResult } from "../../src/data/rugcheck";
import type { JupiterShieldResult } from "../../src/data/jupiterShield";
import type { JupiterTokenResult } from "../../src/data/jupiterTokens";

// Mock all 4 data providers
vi.mock("../../src/data/jupiter");
vi.mock("../../src/data/rugcheck");
vi.mock("../../src/data/jupiterShield");
vi.mock("../../src/data/jupiterTokens");

import { fetchJupiterQuote } from "../../src/data/jupiter";
import { fetchRugcheckReport } from "../../src/data/rugcheck";
import { fetchJupiterShield } from "../../src/data/jupiterShield";
import { fetchJupiterToken } from "../../src/data/jupiterTokens";
import { fetchLiveContext } from "../../src/data/liveContext";

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

const mockQuote: JupiterQuoteResult = {
  priceImpactPct: 0.12,
  outAmount: "750000000",
  routeCount: 3,
};

const mockRugcheck: RugcheckResult = {
  score: 15,
  risks: [{ name: "Low liquidity", level: "warn", description: "Pool is thin", score: 15 }],
};

const mockShieldInput: JupiterShieldResult = {
  mint: SOL_MINT,
  warnings: [],
};

const mockShieldOutput: JupiterShieldResult = {
  mint: USDC_MINT,
  warnings: [{ type: "HAS_FREEZE_AUTHORITY", message: "Token can be frozen", severity: "warning" }],
};

const mockTokenInput: JupiterTokenResult = {
  mint: SOL_MINT,
  symbol: "SOL",
  isVerified: true,
  organicScore: 95,
  liquidity: 500_000_000,
};

const mockTokenOutput: JupiterTokenResult = {
  mint: USDC_MINT,
  symbol: "USDC",
  isVerified: true,
  organicScore: 99,
  liquidity: 1_000_000_000,
};

describe("fetchLiveContext", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      JUPITER_API_KEY: "test-jupiter-key",
      RUGCHECK_API_KEY: "test-rugcheck-key",
    };
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ───────────────────────────────────────────────
  // 1. Všichni 4 provideři uspějí → kompletní kontext
  // ───────────────────────────────────────────────

  it("returns full context when all providers succeed", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(mockQuote);
    vi.mocked(fetchRugcheckReport)
      .mockResolvedValueOnce(mockRugcheck)   // input
      .mockResolvedValueOnce(mockRugcheck);  // output
    vi.mocked(fetchJupiterShield).mockResolvedValue(
      new Map([
        [SOL_MINT, mockShieldInput],
        [USDC_MINT, mockShieldOutput],
      ]),
    );
    vi.mocked(fetchJupiterToken)
      .mockResolvedValueOnce(mockTokenInput)   // input
      .mockResolvedValueOnce(mockTokenOutput);  // output

    const { context: ctx, meta } = await fetchLiveContext(baseTrade);

    expect(ctx.jupiter).toEqual(mockQuote);
    expect(ctx.rugcheck_input).toEqual(mockRugcheck);
    expect(ctx.rugcheck_output).toEqual(mockRugcheck);
    expect(ctx.jupiter_shield_input).toEqual(mockShieldInput);
    expect(ctx.jupiter_shield_output).toEqual(mockShieldOutput);
    expect(ctx.jupiter_token_input).toEqual(mockTokenInput);
    expect(ctx.jupiter_token_output).toEqual(mockTokenOutput);

    // Meta: all 6 sources attempted and succeeded, none failed
    expect(meta.attempted).toHaveLength(6);
    expect(meta.succeeded).toHaveLength(6);
    expect(meta.failed).toHaveLength(0);
    // Every source_detail has status "ok"
    for (const s of meta.source_detail) {
      if (s.status !== "skipped") {
        expect(s.status).toBe("ok");
        expect(s.elapsed_ms).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("calls providers with correct arguments", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);

    await fetchLiveContext(baseTrade);

    expect(fetchJupiterQuote).toHaveBeenCalledWith(baseTrade);
    expect(fetchRugcheckReport).toHaveBeenCalledWith(SOL_MINT);
    expect(fetchRugcheckReport).toHaveBeenCalledWith(USDC_MINT);
    expect(fetchJupiterShield).toHaveBeenCalledWith([SOL_MINT, USDC_MINT]);
    expect(fetchJupiterToken).toHaveBeenCalledWith(SOL_MINT);
    expect(fetchJupiterToken).toHaveBeenCalledWith(USDC_MINT);
  });

  // ───────────────────────────────────────────────
  // 2. Partial failure — 2 ze 4 selžou (timeout)
  // ───────────────────────────────────────────────

  it("returns partial context when Jupiter times out but Rugcheck succeeds", async () => {
    vi.mocked(fetchJupiterQuote).mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));
    vi.mocked(fetchJupiterShield).mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));
    vi.mocked(fetchJupiterToken).mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

    vi.mocked(fetchRugcheckReport)
      .mockResolvedValueOnce(mockRugcheck)
      .mockResolvedValueOnce({ score: 42, risks: [] });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { context: ctx, meta } = await fetchLiveContext(baseTrade);

    // Rugcheck survived
    expect(ctx.rugcheck_input).toEqual(mockRugcheck);
    expect(ctx.rugcheck_output).toEqual({ score: 42, risks: [] });

    // Jupiter fields are absent
    expect(ctx.jupiter).toBeUndefined();
    expect(ctx.jupiter_shield_input).toBeUndefined();
    expect(ctx.jupiter_shield_output).toBeUndefined();
    expect(ctx.jupiter_token_input).toBeUndefined();
    expect(ctx.jupiter_token_output).toBeUndefined();

    // Meta: Jupiter sources failed as timeout, Rugcheck succeeded
    expect(meta.attempted).toHaveLength(6);
    expect(meta.succeeded).toContain("rugcheck:input");
    expect(meta.succeeded).toContain("rugcheck:output");
    expect(meta.failed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "jupiter", status: "timeout" }),
        expect.objectContaining({ source: "jupiter-shield", status: "timeout" }),
      ]),
    );

    // Errors were logged
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns partial context when Rugcheck times out but Jupiter succeeds", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(mockQuote);
    vi.mocked(fetchJupiterShield).mockResolvedValue(
      new Map([[SOL_MINT, mockShieldInput]]),
    );
    vi.mocked(fetchJupiterToken)
      .mockResolvedValueOnce(mockTokenInput)
      .mockResolvedValueOnce(mockTokenOutput);

    vi.mocked(fetchRugcheckReport).mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { context: ctx } = await fetchLiveContext(baseTrade);

    expect(ctx.jupiter).toEqual(mockQuote);
    expect(ctx.jupiter_shield_input).toEqual(mockShieldInput);
    expect(ctx.jupiter_token_input).toEqual(mockTokenInput);
    expect(ctx.jupiter_token_output).toEqual(mockTokenOutput);

    expect(ctx.rugcheck_input).toBeUndefined();
    expect(ctx.rugcheck_output).toBeUndefined();

    consoleSpy.mockRestore();
  });

  // ───────────────────────────────────────────────
  // 3. Všichni 4 selžou → prázdný objekt, žádný crash
  // ───────────────────────────────────────────────

  it("returns empty context when all providers reject (timeout)", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");

    vi.mocked(fetchJupiterQuote).mockRejectedValue(abortError);
    vi.mocked(fetchRugcheckReport).mockRejectedValue(abortError);
    vi.mocked(fetchJupiterShield).mockRejectedValue(abortError);
    vi.mocked(fetchJupiterToken).mockRejectedValue(abortError);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { context: ctx, meta } = await fetchLiveContext(baseTrade);

    expect(ctx.jupiter).toBeUndefined();
    expect(ctx.rugcheck_input).toBeUndefined();
    expect(ctx.rugcheck_output).toBeUndefined();
    expect(ctx.jupiter_shield_input).toBeUndefined();
    expect(ctx.jupiter_shield_output).toBeUndefined();
    expect(ctx.jupiter_token_input).toBeUndefined();
    expect(ctx.jupiter_token_output).toBeUndefined();

    // Meta: all 6 attempted, 0 succeeded, all 6 failed as timeout
    expect(meta.attempted).toHaveLength(6);
    expect(meta.succeeded).toHaveLength(0);
    expect(meta.failed).toHaveLength(6);
    for (const f of meta.failed) {
      expect(f.status).toBe("timeout");
    }

    consoleSpy.mockRestore();
  });

  it("returns empty context when all providers return null", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);

    const { context: ctx, meta } = await fetchLiveContext(baseTrade);

    expect(ctx.jupiter).toBeUndefined();
    expect(ctx.rugcheck_input).toBeUndefined();

    // null returns are "ok" (API responded, just no data) — not failures,
    // but they don't count as "succeeded" since no data was contributed
    expect(meta.attempted).toHaveLength(6);
    expect(meta.succeeded).toHaveLength(0);
    expect(meta.failed).toHaveLength(0);
  });

  // ───────────────────────────────────────────────
  // 4. Malformed response — graceful handling
  // ───────────────────────────────────────────────

  it("handles provider throwing unexpected error gracefully", async () => {
    vi.mocked(fetchJupiterQuote).mockRejectedValue(new TypeError("Cannot read properties of undefined"));
    vi.mocked(fetchRugcheckReport).mockResolvedValue(mockRugcheck);
    vi.mocked(fetchJupiterShield).mockRejectedValue(new SyntaxError("Unexpected token < in JSON"));
    vi.mocked(fetchJupiterToken).mockResolvedValue(mockTokenInput);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { context: ctx } = await fetchLiveContext(baseTrade);

    // Failed providers are absent
    expect(ctx.jupiter).toBeUndefined();
    expect(ctx.jupiter_shield_input).toBeUndefined();
    expect(ctx.jupiter_shield_output).toBeUndefined();

    // Healthy providers still populated
    expect(ctx.rugcheck_input).toEqual(mockRugcheck);
    expect(ctx.jupiter_token_input).toEqual(mockTokenInput);

    consoleSpy.mockRestore();
  });

  // ───────────────────────────────────────────────
  // API key gating
  // ───────────────────────────────────────────────

  it("calls only Rugcheck when Jupiter API key is missing", async () => {
    delete process.env.JUPITER_API_KEY;
    delete process.env.RUGCHECK_API_KEY;  // key not needed for Rugcheck

    vi.mocked(fetchRugcheckReport).mockResolvedValue(mockRugcheck);

    const { meta } = await fetchLiveContext(baseTrade);

    // Jupiter sources skipped (no key), Rugcheck still called (public API)
    expect(fetchJupiterQuote).not.toHaveBeenCalled();
    expect(fetchJupiterShield).not.toHaveBeenCalled();
    expect(fetchJupiterToken).not.toHaveBeenCalled();
    expect(fetchRugcheckReport).toHaveBeenCalledTimes(2);

    // 4 Jupiter sources skipped, 2 Rugcheck attempted
    expect(meta.attempted).toHaveLength(2);
    expect(meta.succeeded).toHaveLength(2);
    const skipped = meta.source_detail.filter(s => s.status === "skipped");
    expect(skipped).toHaveLength(4);
  });

  it("calls all 6 sources when Jupiter API key is set", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(mockQuote);
    vi.mocked(fetchRugcheckReport).mockResolvedValue(mockRugcheck);
    vi.mocked(fetchJupiterShield).mockResolvedValue(new Map());
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);

    await fetchLiveContext(baseTrade);

    expect(fetchJupiterQuote).toHaveBeenCalledOnce();
    expect(fetchJupiterShield).toHaveBeenCalledOnce();
    expect(fetchJupiterToken).toHaveBeenCalledTimes(2);
    expect(fetchRugcheckReport).toHaveBeenCalledTimes(2);
  });

  it("treats placeholder Jupiter key as unconfigured but still calls Rugcheck", async () => {
    process.env.JUPITER_API_KEY = "<YOUR-JUPITER-API-KEY>";

    vi.mocked(fetchRugcheckReport).mockResolvedValue(mockRugcheck);

    await fetchLiveContext(baseTrade);

    expect(fetchJupiterQuote).not.toHaveBeenCalled();
    expect(fetchJupiterShield).not.toHaveBeenCalled();
    expect(fetchJupiterToken).not.toHaveBeenCalled();
    expect(fetchRugcheckReport).toHaveBeenCalledTimes(2);
  });

  it("skips Rugcheck when RUGCHECK_DISABLED=true", async () => {
    process.env.RUGCHECK_DISABLED = "true";

    vi.mocked(fetchJupiterQuote).mockResolvedValue(mockQuote);
    vi.mocked(fetchJupiterShield).mockResolvedValue(new Map());
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);

    const { meta } = await fetchLiveContext(baseTrade);

    expect(fetchRugcheckReport).not.toHaveBeenCalled();
    expect(fetchJupiterQuote).toHaveBeenCalledOnce();

    const rugSkipped = meta.source_detail.filter(s => s.source.startsWith("rugcheck") && s.status === "skipped");
    expect(rugSkipped).toHaveLength(2);
  });

  // ───────────────────────────────────────────────
  // Shield map unpacking — partial mints
  // ───────────────────────────────────────────────

  it("populates only jupiter_shield_input when Shield map contains only input mint", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(
      new Map([[SOL_MINT, mockShieldInput]]),
    );

    const { context: ctx } = await fetchLiveContext(baseTrade);

    expect(ctx.jupiter_shield_input).toEqual(mockShieldInput);
    expect(ctx.jupiter_shield_output).toBeUndefined();
  });

  it("populates only jupiter_shield_output when Shield map contains only output mint", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(
      new Map([[USDC_MINT, mockShieldOutput]]),
    );

    const { context: ctx } = await fetchLiveContext(baseTrade);

    expect(ctx.jupiter_shield_input).toBeUndefined();
    expect(ctx.jupiter_shield_output).toEqual(mockShieldOutput);
  });

  it("ignores Shield data for unrelated mints", async () => {
    const unknownMint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(
      new Map([
        [unknownMint, { mint: unknownMint, warnings: [{ type: "NOT_SELLABLE", message: "honeypot", severity: "critical" }] }],
      ]),
    );

    const { context: ctx } = await fetchLiveContext(baseTrade);

    expect(ctx.jupiter_shield_input).toBeUndefined();
    expect(ctx.jupiter_shield_output).toBeUndefined();
  });

  it("handles Shield returning empty map", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(new Map());

    const { context: ctx } = await fetchLiveContext(baseTrade);

    expect(ctx.jupiter_shield_input).toBeUndefined();
    expect(ctx.jupiter_shield_output).toBeUndefined();
  });

  // ───────────────────────────────────────────────
  // Rugcheck asymmetric failures
  // ───────────────────────────────────────────────

  it("preserves Rugcheck input when output rejects", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport)
      .mockResolvedValueOnce(mockRugcheck)
      .mockRejectedValueOnce(new Error("output timeout"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { context: ctx } = await fetchLiveContext(baseTrade);

    expect(ctx.rugcheck_input).toEqual(mockRugcheck);
    expect(ctx.rugcheck_output).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it("preserves Rugcheck output when input rejects", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport)
      .mockRejectedValueOnce(new Error("input timeout"))
      .mockResolvedValueOnce({ score: 5, risks: [] });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { context: ctx } = await fetchLiveContext(baseTrade);

    expect(ctx.rugcheck_input).toBeUndefined();
    expect(ctx.rugcheck_output).toEqual({ score: 5, risks: [] });
    consoleSpy.mockRestore();
  });

  // ───────────────────────────────────────────────
  // Error logging per provider
  // ───────────────────────────────────────────────

  it("logs provider-specific error for Jupiter rejection", async () => {
    vi.mocked(fetchJupiterQuote).mockRejectedValue(new Error("jupiter down"));
    vi.mocked(fetchRugcheckReport).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await fetchLiveContext(baseTrade);

    expect(consoleSpy).toHaveBeenCalledWith("jupiter fetch failed:", expect.any(String));
    consoleSpy.mockRestore();
  });

  it("logs provider-specific error for Rugcheck input rejection", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport)
      .mockRejectedValueOnce(new Error("rugcheck input fail"))
      .mockResolvedValueOnce(null);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await fetchLiveContext(baseTrade);

    expect(consoleSpy).toHaveBeenCalledWith("rugcheck:input fetch failed:", expect.any(String));
    consoleSpy.mockRestore();
  });

  it("logs provider-specific error for Rugcheck output rejection", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("rugcheck output fail"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await fetchLiveContext(baseTrade);

    expect(consoleSpy).toHaveBeenCalledWith("rugcheck:output fetch failed:", expect.any(String));
    consoleSpy.mockRestore();
  });

  it("logs provider-specific error for Jupiter Shield rejection", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockRejectedValue(new Error("shield down"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await fetchLiveContext(baseTrade);

    expect(consoleSpy).toHaveBeenCalledWith("jupiter-shield fetch failed:", expect.any(String));
    consoleSpy.mockRestore();
  });

  it("logs provider-specific error for Jupiter Tokens input rejection", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken)
      .mockRejectedValueOnce(new Error("tokens input fail"))
      .mockResolvedValueOnce(null);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await fetchLiveContext(baseTrade);

    expect(consoleSpy).toHaveBeenCalledWith("jupiter-tokens:input fetch failed:", expect.any(String));
    consoleSpy.mockRestore();
  });

  it("logs provider-specific error for Jupiter Tokens output rejection", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("tokens output fail"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await fetchLiveContext(baseTrade);

    expect(consoleSpy).toHaveBeenCalledWith("jupiter-tokens:output fetch failed:", expect.any(String));
    consoleSpy.mockRestore();
  });

  // ───────────────────────────────────────────────
  // Same mint for input and output
  // ───────────────────────────────────────────────

  it("unpacks Shield consistently when input_mint equals output_mint", async () => {
    const sameMintTrade: ValidatedTradeCheck = {
      ...baseTrade,
      input_mint: SOL_MINT,
      output_mint: SOL_MINT,
    };

    const shieldData: JupiterShieldResult = {
      mint: SOL_MINT,
      warnings: [{ type: "LOW_ORGANIC_ACTIVITY", message: "Low activity", severity: "info" }],
    };

    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(
      new Map([[SOL_MINT, shieldData]]),
    );

    const { context: ctx } = await fetchLiveContext(sameMintTrade);

    expect(ctx.jupiter_shield_input).toEqual(shieldData);
    expect(ctx.jupiter_shield_output).toEqual(shieldData);
  });

  it("does not corrupt Rugcheck context when input_mint equals output_mint", async () => {
    const sameMintTrade: ValidatedTradeCheck = {
      ...baseTrade,
      input_mint: SOL_MINT,
      output_mint: SOL_MINT,
    };

    const rugResult1: RugcheckResult = { score: 10, risks: [] };
    const rugResult2: RugcheckResult = { score: 20, risks: [] };

    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchJupiterShield).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport)
      .mockResolvedValueOnce(rugResult1)
      .mockResolvedValueOnce(rugResult2);

    const { context: ctx } = await fetchLiveContext(sameMintTrade);

    expect(ctx.rugcheck_input).toEqual(rugResult1);
    expect(ctx.rugcheck_output).toEqual(rugResult2);
    expect(fetchRugcheckReport).toHaveBeenCalledTimes(2);
    expect(fetchRugcheckReport).toHaveBeenNthCalledWith(1, SOL_MINT);
    expect(fetchRugcheckReport).toHaveBeenNthCalledWith(2, SOL_MINT);
  });

  // ───────────────────────────────────────────────
  // Mixed null + reject
  // ───────────────────────────────────────────────

  it("handles mixed: some providers return null, others reject", async () => {
    vi.mocked(fetchJupiterQuote).mockResolvedValue(null);
    vi.mocked(fetchRugcheckReport).mockRejectedValue(new Error("network"));
    vi.mocked(fetchJupiterShield).mockResolvedValue(null);
    vi.mocked(fetchJupiterToken)
      .mockResolvedValueOnce(mockTokenInput)
      .mockRejectedValueOnce(new Error("timeout"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { context: ctx } = await fetchLiveContext(baseTrade);

    expect(ctx.jupiter).toBeUndefined();
    expect(ctx.rugcheck_input).toBeUndefined();
    expect(ctx.rugcheck_output).toBeUndefined();
    expect(ctx.jupiter_shield_input).toBeUndefined();
    expect(ctx.jupiter_token_input).toEqual(mockTokenInput);
    expect(ctx.jupiter_token_output).toBeUndefined();

    consoleSpy.mockRestore();
  });
});

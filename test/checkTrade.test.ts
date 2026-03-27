import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { SOL_MINT, TOKEN_MINTS } from "../src/data/mints";

const USDC_MINT = TOKEN_MINTS["USDC"];
const BONK_MINT = TOKEN_MINTS["BONK"];
const app = createApp({ disableRateLimit: true });

// Disable Rugcheck in integration tests to keep them deterministic
// (Rugcheck is a public API that would otherwise be called in every test)
const origRugcheckDisabled = process.env.RUGCHECK_DISABLED;
beforeAll(() => { process.env.RUGCHECK_DISABLED = "true"; });
afterAll(() => {
  if (origRugcheckDisabled === undefined) delete process.env.RUGCHECK_DISABLED;
  else process.env.RUGCHECK_DISABLED = origRugcheckDisabled;
});

// --- Health endpoint ---

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.version).toBe("0.5.0");
  });
});

// --- Valid check-trade requests ---

describe("POST /check-trade — valid requests", () => {
  it("returns 200 with risk assessment for a low-risk trade", async () => {
    const res = await request(app)
      .post("/check-trade")
      .send({
        chain: "solana",
        input_mint: SOL_MINT,
        output_mint: USDC_MINT,
        amount_in: 2,
        slippage_bps: 50,
        send_mode: "protected",
        priority_fee_lamports: 5000,
      });

    expect(res.status).toBe(200);
    expect(res.body.risk_level).toBe("low");
    expect(res.body.reason).toBeDefined();
    expect(res.body.recommendation).toBeDefined();
    expect(res.body.confidence).toBe("medium");
    expect(res.body.triggered_rules).toEqual([]);
    expect(res.body.rule_details).toHaveLength(8);
    expect(res.body.request_id).toBeDefined();
    expect(res.body.live_sources).toEqual([]);
    // Phase A fields: degraded mode and provenance
    expect(res.body.degraded).toBe(false);
    expect(res.body.degraded_reasons).toEqual([]);
    expect(res.body.provenance).toBeDefined();
    expect(Array.isArray(res.body.provenance)).toBe(true);
  });

  it("returns 200 with high risk for a dangerous trade", async () => {
    const res = await request(app)
      .post("/check-trade")
      .send({
        chain: "solana",
        input_mint: SOL_MINT,
        output_mint: USDC_MINT,
        amount_in: 60,
        slippage_bps: 500,
        send_mode: "unknown",
      });

    expect(res.status).toBe(200);
    expect(res.body.risk_level).toBe("high");
    expect(res.body.triggered_rules.length).toBeGreaterThan(0);
  });
});

// --- Invalid check-trade requests ---

describe("POST /check-trade — invalid requests", () => {
  it("returns 400 for non-solana chain", async () => {
    const res = await request(app)
      .post("/check-trade")
      .send({
        chain: "ethereum",
        input_mint: SOL_MINT,
        output_mint: USDC_MINT,
        amount_in: 5,
        slippage_bps: 100,
        send_mode: "standard",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.details).toBeDefined();
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("returns 400 for missing required fields", async () => {
    const res = await request(app)
      .post("/check-trade")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 for negative amount", async () => {
    const res = await request(app)
      .post("/check-trade")
      .send({
        chain: "solana",
        input_mint: SOL_MINT,
        output_mint: USDC_MINT,
        amount_in: -5,
        slippage_bps: 100,
        send_mode: "standard",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 for invalid mint address", async () => {
    const res = await request(app)
      .post("/check-trade")
      .send({
        chain: "solana",
        input_mint: "not-a-mint",
        output_mint: USDC_MINT,
        amount_in: 5,
        slippage_bps: 100,
        send_mode: "standard",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});

// --- Degraded mode round-trip ---

describe("POST /check-trade — degraded mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns degraded: true when a critical source fails", async () => {
    // Mock fetchLiveContext to simulate rugcheck:output timeout
    const { fetchLiveContext } = await import("../src/data/liveContext");
    const spy = vi.spyOn(await import("../src/data/liveContext"), "fetchLiveContext");
    spy.mockResolvedValue({
      context: {},
      meta: {
        attempted: ["rugcheck:output"],
        succeeded: [],
        failed: [{ source: "rugcheck:output", status: "timeout" }],
        source_detail: [
          { source: "rugcheck:output", status: "timeout", elapsed_ms: 3000, fields_returned: [] },
        ],
      },
    });

    // Fresh app to pick up the mock
    const degradedApp = createApp({ disableRateLimit: true });

    // Use SOL→BONK (meme token) so escalation fires for unknown/meme output
    const res = await request(degradedApp)
      .post("/check-trade")
      .send({
        chain: "solana",
        input_mint: SOL_MINT,
        output_mint: BONK_MINT,
        amount_in: 2,
        slippage_bps: 50,
        send_mode: "protected",
        priority_fee_lamports: 5000,
      });

    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    expect(res.body.degraded_reasons).toEqual([
      { source: "rugcheck:output", status: "timeout" },
    ]);
    // Critical source failed for meme token → escalated from allow to warn
    expect(res.body.decision).toBe("warn");
    expect(res.body.reason).toContain("rugcheck:output");
    expect(res.body.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "rugcheck:output", status: "timeout" }),
      ]),
    );
  });
});

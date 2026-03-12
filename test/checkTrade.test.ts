import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

// --- Health endpoint ---

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.version).toBe("0.1.0");
  });
});

// --- Valid check-trade requests ---

describe("POST /check-trade — valid requests", () => {
  it("returns 200 with risk assessment for a low-risk trade", async () => {
    const res = await request(app)
      .post("/check-trade")
      .send({
        chain: "solana",
        pair: "SOL/USDC",
        amount_in: 2,
        amount_in_symbol: "SOL",
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
    expect(res.body.rule_details).toHaveLength(6);
    expect(res.body.request_id).toBeDefined();
  });

  it("returns 200 with high risk for a dangerous trade", async () => {
    const res = await request(app)
      .post("/check-trade")
      .send({
        chain: "solana",
        pair: "SOL/USDC",
        amount_in: 60,
        amount_in_symbol: "SOL",
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
        pair: "ETH/USDC",
        amount_in: 5,
        amount_in_symbol: "ETH",
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
        pair: "SOL/USDC",
        amount_in: -5,
        amount_in_symbol: "SOL",
        slippage_bps: 100,
        send_mode: "standard",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});

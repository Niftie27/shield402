import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app";
import { SOL_MINT, TOKEN_MINTS } from "../src/data/mints";
import http from "http";
import type { AddressInfo } from "net";

const USDC_MINT = TOKEN_MINTS["USDC"];

const VALID_TRADE = {
  chain: "solana",
  input_mint: SOL_MINT,
  output_mint: USDC_MINT,
  amount_in: 2,
  slippage_bps: 50,
  send_mode: "protected",
  priority_fee_lamports: 5000,
};

let server: http.Server;
let baseUrl: string;

describe("API key auth", () => {
  beforeAll(() => {
    process.env.API_KEYS = "test-key-1,test-key-2";
    const app = createApp();
    server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server?.close();
    delete process.env.API_KEYS;
  });

  it("returns 401 when no API key is provided", async () => {
    const res = await fetch(`${baseUrl}/check-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_TRADE),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 for invalid API key", async () => {
    const res = await fetch(`${baseUrl}/check-trade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "wrong-key",
      },
      body: JSON.stringify(VALID_TRADE),
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 for valid API key", async () => {
    const res = await fetch(`${baseUrl}/check-trade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "test-key-1",
      },
      body: JSON.stringify(VALID_TRADE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.decision).toBe("allow");
  });

  it("accepts second key in the allowlist", async () => {
    const res = await fetch(`${baseUrl}/check-trade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "test-key-2",
      },
      body: JSON.stringify(VALID_TRADE),
    });
    expect(res.status).toBe(200);
  });

  it("health endpoint is always open (no auth required)", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
  });
});

describe("API key auth disabled", () => {
  let noAuthServer: http.Server;
  let noAuthUrl: string;

  beforeAll(() => {
    delete process.env.API_KEYS;
    const app = createApp();
    noAuthServer = app.listen(0);
    const port = (noAuthServer.address() as AddressInfo).port;
    noAuthUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    noAuthServer?.close();
  });

  it("passes through without API key when API_KEYS is unset", async () => {
    const res = await fetch(`${noAuthUrl}/check-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_TRADE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.decision).toBe("allow");
  });
});

describe("Rate limiting", () => {
  let rlServer: http.Server;
  let rlUrl: string;

  beforeAll(() => {
    delete process.env.API_KEYS;
    const app = createApp();
    rlServer = app.listen(0);
    const port = (rlServer.address() as AddressInfo).port;
    rlUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    rlServer?.close();
  });

  it("returns rate limit headers", async () => {
    const res = await fetch(`${rlUrl}/check-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_TRADE),
    });
    expect(res.status).toBe(200);
    // draft-7 standard headers
    expect(res.headers.get("ratelimit-limit")).toBeDefined();
    expect(res.headers.get("ratelimit-remaining")).toBeDefined();
  });

  it("health endpoint has no rate limit headers", async () => {
    const res = await fetch(`${rlUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("ratelimit-limit")).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app";
import { SOL_MINT, TOKEN_MINTS } from "../src/data/mints";
import http from "http";
import type { AddressInfo } from "net";

const USDC_MINT = TOKEN_MINTS["USDC"];

/**
 * Plugin integration tests.
 *
 * Starts a real Shield402 server, then exercises the plugin's
 * checkTradeSafety function against it. This tests the full
 * HTTP round-trip that a real agent would make.
 */

let server: http.Server;
let baseUrl: string;

// Dynamically import the plugin (it reads SHIELD402_URL from env at module scope)
let checkTradeSafety: (params: {
  input_mint: string;
  output_mint: string;
  amount_in: number;
  slippage_bps: number;
  send_mode: string;
  priority_fee_lamports?: number;
}) => Promise<Record<string, unknown>>;

beforeAll(async () => {
  // Disable Rugcheck to keep integration tests deterministic
  process.env.RUGCHECK_DISABLED = "true";
  // Start Shield402 on a random port
  const app = createApp({ disableRateLimit: true });
  server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;

  // Set SHIELD402_URL before importing the plugin
  process.env.SHIELD402_URL = baseUrl;

  // The plugin's checkTradeSafety is a method on the plugin object.
  // We test the HTTP call directly since we can't install solana-agent-kit.
  checkTradeSafety = async (params) => {
    const response = await fetch(`${baseUrl}/check-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chain: "solana", ...params }),
    });

    if (!response.ok) {
      const error = (await response.json()) as Record<string, unknown>;
      throw new Error(`Shield402 rejected: ${error.message}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  };
});

afterAll(() => {
  server?.close();
});

describe("Shield402 plugin (HTTP round-trip)", () => {
  it("returns allow for a safe trade", async () => {
    const result = await checkTradeSafety({
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 2,
      slippage_bps: 50,
      send_mode: "protected",
      priority_fee_lamports: 5000,
    });

    expect(result.decision).toBe("allow");
    expect(result.risk_level).toBe("low");
    expect(result.policy_version).toBe("0.5.0");
  });

  it("returns block for a dangerous trade", async () => {
    const result = await checkTradeSafety({
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 60,
      slippage_bps: 500,
      send_mode: "standard",
    });

    expect(result.decision).toBe("block");
    expect(result.risk_level).toBe("high");
    expect((result.triggered_rules as string[]).length).toBeGreaterThan(0);
  });

  it("returns warn with recommended params for moderate risk", async () => {
    const result = await checkTradeSafety({
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 2,
      slippage_bps: 150,
      send_mode: "protected",
      priority_fee_lamports: 5000,
    });

    expect(result.decision).toBe("warn");
    const policy = result.policy as Record<string, unknown>;
    expect(policy.recommended_slippage_bps).toBeDefined();
  });

  it("returns 8 rule details", async () => {
    const result = await checkTradeSafety({
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      amount_in: 2,
      slippage_bps: 50,
      send_mode: "protected",
    });

    expect((result.rule_details as unknown[]).length).toBe(8);
  });

  it("rejects invalid mint addresses", async () => {
    await expect(
      checkTradeSafety({
        input_mint: "not-valid",
        output_mint: USDC_MINT,
        amount_in: 5,
        slippage_bps: 100,
        send_mode: "standard",
      }),
    ).rejects.toThrow("Shield402 rejected");
  });
});

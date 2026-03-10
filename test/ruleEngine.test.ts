import { describe, it, expect } from "vitest";
import { evaluateTrade } from "../src/rules/index";
import type { ValidatedTradeCheck } from "../src/schema/checkTradeSchema";

// Helper to build a trade request with sensible defaults.
// Override only what you need per test.
function makeTrade(overrides: Partial<ValidatedTradeCheck> = {}): ValidatedTradeCheck {
  return {
    chain: "solana",
    pair: "SOL/USDC",
    amount_in: 2,
    amount_in_symbol: "SOL",
    slippage_bps: 50,
    send_mode: "protected",
    priority_fee_lamports: 5000,
    ...overrides,
  };
}

// --- Low risk cases ---

describe("low risk trades", () => {
  it("returns low risk for a small protected trade with tight slippage", () => {
    const result = evaluateTrade(makeTrade());

    expect(result.risk_level).toBe("low");
    expect(result.triggered_rules).toEqual([]);
  });

  it("returns low risk even without route_hint (it's truly optional)", () => {
    const result = evaluateTrade(makeTrade({ route_hint: undefined }));

    expect(result.risk_level).toBe("low");
  });
});

// --- Slippage rule ---

describe("slippage rule", () => {
  it("flags caution when slippage is above 100 bps", () => {
    const result = evaluateTrade(makeTrade({ slippage_bps: 150 }));

    expect(result.triggered_rules).toContain("slippage_too_wide");
    expect(result.risk_level).toBe("caution");
  });

  it("flags high when slippage is above 300 bps", () => {
    const result = evaluateTrade(makeTrade({ slippage_bps: 400 }));

    const slippageDetail = result.rule_details.find(
      (r) => r.rule_id === "slippage_too_wide"
    );
    expect(slippageDetail?.triggered).toBe(true);
    expect(slippageDetail?.severity).toBe("high");
  });

  it("does not flag slippage at exactly 100 bps", () => {
    const result = evaluateTrade(makeTrade({ slippage_bps: 100 }));

    const slippageDetail = result.rule_details.find(
      (r) => r.rule_id === "slippage_too_wide"
    );
    expect(slippageDetail?.triggered).toBe(false);
  });
});

// --- Send mode rule ---

describe("send mode rule", () => {
  it("flags caution for standard send mode", () => {
    const result = evaluateTrade(makeTrade({ send_mode: "standard" }));

    expect(result.triggered_rules).toContain("unprotected_send_mode");
  });

  it("flags caution for unknown send mode", () => {
    const result = evaluateTrade(makeTrade({ send_mode: "unknown" }));

    expect(result.triggered_rules).toContain("unprotected_send_mode");
  });

  it("does not flag protected send mode", () => {
    const result = evaluateTrade(makeTrade({ send_mode: "protected" }));

    expect(result.triggered_rules).not.toContain("unprotected_send_mode");
  });
});

// --- Size risk rule ---

describe("size risk rule", () => {
  it("flags caution for large SOL trade with wide slippage", () => {
    const result = evaluateTrade(
      makeTrade({ amount_in: 15, slippage_bps: 150 })
    );

    expect(result.triggered_rules).toContain("large_trade_loose_settings");
  });

  it("flags high for very large SOL trade with wide slippage", () => {
    const result = evaluateTrade(
      makeTrade({ amount_in: 60, slippage_bps: 150 })
    );

    const sizeDetail = result.rule_details.find(
      (r) => r.rule_id === "large_trade_loose_settings"
    );
    expect(sizeDetail?.triggered).toBe(true);
    expect(sizeDetail?.severity).toBe("high");
  });

  it("skips size check for non-SOL tokens", () => {
    const result = evaluateTrade(
      makeTrade({
        amount_in: 100,
        amount_in_symbol: "BONK",
        slippage_bps: 500,
        send_mode: "standard",
      })
    );

    const sizeDetail = result.rule_details.find(
      (r) => r.rule_id === "large_trade_loose_settings"
    );
    expect(sizeDetail?.triggered).toBe(false);
  });

  it("flags caution for large trade with low priority fee", () => {
    const result = evaluateTrade(
      makeTrade({
        amount_in: 15,
        slippage_bps: 50, // tight slippage, so size+slippage won't fire
        priority_fee_lamports: 500,
      })
    );

    expect(result.triggered_rules).toContain("large_trade_loose_settings");
  });
});

// --- Missing fields rule ---

describe("missing fields rule", () => {
  it("flags caution when priority_fee_lamports is missing", () => {
    const result = evaluateTrade(
      makeTrade({ priority_fee_lamports: undefined })
    );

    expect(result.triggered_rules).toContain("missing_execution_params");
  });

  it("does not flag when priority_fee_lamports is present", () => {
    const result = evaluateTrade(makeTrade({ priority_fee_lamports: 5000 }));

    expect(result.triggered_rules).not.toContain("missing_execution_params");
  });
});

// --- Unsafe combination rule ---

describe("unsafe combination rule", () => {
  it("flags high when large + wide slippage + unprotected all combine", () => {
    const result = evaluateTrade(
      makeTrade({
        amount_in: 20,
        slippage_bps: 200,
        send_mode: "standard",
      })
    );

    expect(result.triggered_rules).toContain("unsafe_combination");
    expect(result.risk_level).toBe("high");
  });

  it("does not fire when trade is small even if slippage is wide and unprotected", () => {
    const result = evaluateTrade(
      makeTrade({
        amount_in: 2,
        slippage_bps: 200,
        send_mode: "standard",
      })
    );

    expect(result.triggered_rules).not.toContain("unsafe_combination");
  });

  it("does not fire when send mode is protected even if large and wide", () => {
    const result = evaluateTrade(
      makeTrade({
        amount_in: 20,
        slippage_bps: 200,
        send_mode: "protected",
      })
    );

    expect(result.triggered_rules).not.toContain("unsafe_combination");
  });
});

// --- Aggregation behavior ---

describe("result aggregation", () => {
  it("picks the highest severity as overall risk_level", () => {
    // This trade triggers both caution and high rules
    const result = evaluateTrade(
      makeTrade({
        amount_in: 60,
        slippage_bps: 500,
        send_mode: "unknown",
      })
    );

    expect(result.risk_level).toBe("high");
  });

  it("returns a reason string that is not empty", () => {
    const result = evaluateTrade(makeTrade({ slippage_bps: 200 }));

    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("returns a recommendation string that is not empty", () => {
    const result = evaluateTrade(makeTrade({ slippage_bps: 200 }));

    expect(result.recommendation.length).toBeGreaterThan(0);
  });

  it("always returns confidence as medium in v1", () => {
    const result = evaluateTrade(makeTrade());

    expect(result.confidence).toBe("medium");
  });

  it("returns rule_details for every rule even when not triggered", () => {
    const result = evaluateTrade(makeTrade());

    // 5 rules should always appear in rule_details
    expect(result.rule_details).toHaveLength(5);
  });
});

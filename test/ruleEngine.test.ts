import { describe, it, expect } from "vitest";
import { evaluateTrade } from "../src/rules/index";
import type { ValidatedTradeCheck } from "../src/schema/checkTradeSchema";
import type { LiveContextMeta } from "../src/data/liveContext";
import { SOL_MINT, TOKEN_MINTS } from "../src/data/mints";
import { VERSION } from "../src/config/version";

const USDC_MINT = TOKEN_MINTS["USDC"];
const BONK_MINT = TOKEN_MINTS["BONK"];

// Helper to build a trade request with sensible defaults.
// Override only what you need per test.
function makeTrade(overrides: Partial<ValidatedTradeCheck> = {}): ValidatedTradeCheck {
  return {
    chain: "solana",
    input_mint: SOL_MINT,
    output_mint: USDC_MINT,
    amount_in: 2,
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

  it("skips size check for non-SOL input tokens", () => {
    const result = evaluateTrade(
      makeTrade({
        input_mint: BONK_MINT,
        output_mint: USDC_MINT,
        amount_in: 100,
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

  it("flags caution for non-SOL input with wide slippage + unprotected", () => {
    const result = evaluateTrade(
      makeTrade({
        input_mint: BONK_MINT,
        output_mint: USDC_MINT,
        amount_in: 100,
        slippage_bps: 200,
        send_mode: "standard",
      })
    );

    const detail = result.rule_details.find(
      (r) => r.rule_id === "unsafe_combination"
    );
    expect(detail?.triggered).toBe(true);
    expect(detail?.severity).toBe("caution");
    expect(detail?.evidence).toMatchObject({
      factors: ["wide_slippage", "unprotected_send"],
    });
  });

  it("does not fire non-SOL path when send mode is protected", () => {
    const result = evaluateTrade(
      makeTrade({
        input_mint: BONK_MINT,
        output_mint: USDC_MINT,
        amount_in: 100,
        slippage_bps: 200,
        send_mode: "protected",
      })
    );

    const detail = result.rule_details.find(
      (r) => r.rule_id === "unsafe_combination"
    );
    expect(detail?.triggered).toBe(false);
  });

  it("does not fire non-SOL path when slippage is tight", () => {
    const result = evaluateTrade(
      makeTrade({
        input_mint: BONK_MINT,
        output_mint: USDC_MINT,
        amount_in: 100,
        slippage_bps: 50,
        send_mode: "standard",
      })
    );

    const detail = result.rule_details.find(
      (r) => r.rule_id === "unsafe_combination"
    );
    expect(detail?.triggered).toBe(false);
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

  it("returns confidence as medium when no live data", () => {
    const result = evaluateTrade(makeTrade());

    expect(result.confidence).toBe("medium");
  });

  it("returns empty live_sources when no live data", () => {
    const result = evaluateTrade(makeTrade());

    expect(result.live_sources).toEqual([]);
  });

  it("returns rule_details for every rule even when not triggered", () => {
    const result = evaluateTrade(makeTrade());

    // 8 rules should always appear in rule_details (5 static + 3 live-data)
    expect(result.rule_details).toHaveLength(8);
  });
});

// --- Policy decision ---

describe("policy decision", () => {
  it("returns allow for low-risk trades", () => {
    const result = evaluateTrade(makeTrade());

    expect(result.decision).toBe("allow");
    expect(result.policy).toEqual({});
    expect(result.policy_version).toBe("0.5.0");
  });

  it("returns warn for caution-level trades", () => {
    const result = evaluateTrade(makeTrade({ slippage_bps: 150 }));

    expect(result.decision).toBe("warn");
  });

  it("returns block for high-risk trades", () => {
    const result = evaluateTrade(
      makeTrade({
        amount_in: 20,
        slippage_bps: 200,
        send_mode: "standard",
      })
    );

    expect(result.decision).toBe("block");
  });

  it("recommends tighter slippage when slippage rule fires", () => {
    const result = evaluateTrade(makeTrade({ slippage_bps: 150 }));

    expect(result.policy.recommended_slippage_bps).toBe(75);
  });

  it("recommends very tight slippage for extreme values", () => {
    const result = evaluateTrade(makeTrade({ slippage_bps: 400 }));

    expect(result.policy.recommended_slippage_bps).toBe(50);
  });

  it("recommends protected send when unprotected", () => {
    const result = evaluateTrade(makeTrade({ send_mode: "standard" }));

    expect(result.policy.recommended_send_mode).toBe("protected");
  });

  it("recommends priority fee when missing", () => {
    const result = evaluateTrade(
      makeTrade({ priority_fee_lamports: undefined })
    );

    expect(result.policy.recommended_priority_fee_lamports).toBe(10000);
  });

  it("returns empty policy for allow decisions", () => {
    const result = evaluateTrade(makeTrade());

    expect(result.decision).toBe("allow");
    expect(result.policy.recommended_slippage_bps).toBeUndefined();
    expect(result.policy.recommended_send_mode).toBeUndefined();
    expect(result.policy.recommended_priority_fee_lamports).toBeUndefined();
  });

  it("gives actionable recommendation for high price impact", () => {
    const liveContext = {
      jupiter: { priceImpactPct: 6.5, outAmount: "100", routeCount: 1 },
    };

    // slippage_bps: 50 is already tighter than any recommendation (75),
    // so no slippage recommendation is emitted — only the text advice
    const result = evaluateTrade(makeTrade({ slippage_bps: 50 }), liveContext);

    expect(result.triggered_rules).toContain("high_price_impact");
    expect(result.recommendation).toContain("price impact");
    expect(result.policy.recommended_slippage_bps).toBeUndefined();
  });

  it("shows <0.01% for tiny non-zero price impact instead of 0.00%", () => {
    const liveContext = {
      jupiter: { priceImpactPct: 0.001, outAmount: "100", routeCount: 1 },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "high_price_impact");
    expect(detail?.message).toContain("<0.01%");
    expect(detail?.message).not.toContain("0.00%");
  });

  it("shows normal formatting for price impact >= 0.01%", () => {
    const liveContext = {
      jupiter: { priceImpactPct: 0.12, outAmount: "100", routeCount: 1 },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "high_price_impact");
    expect(detail?.message).toContain("0.12%");
  });

  it("gives actionable recommendation for caution-level price impact", () => {
    const liveContext = {
      jupiter: { priceImpactPct: 2.5, outAmount: "100", routeCount: 1 },
    };

    const result = evaluateTrade(makeTrade({ slippage_bps: 50 }), liveContext);

    expect(result.triggered_rules).toContain("high_price_impact");
    expect(result.decision).toBe("warn");
    expect(result.recommendation).toContain("price impact");
  });

  // --- Recommendation safety guards ---

  it("does not recommend wider slippage than user provided", () => {
    // User has 50bps, target would be 75bps — that's wider, don't recommend
    const result = evaluateTrade(makeTrade({ slippage_bps: 50, send_mode: "standard" }));
    expect(result.triggered_rules).toContain("unprotected_send_mode");
    expect(result.policy.recommended_slippage_bps).toBeUndefined();
  });

  it("does not recommend lower priority fee than user provided", () => {
    // User has 50000 lamports, our target is 10000 — don't downgrade
    const result = evaluateTrade(makeTrade({ priority_fee_lamports: 50000, send_mode: "standard" }));
    expect(result.policy.recommended_priority_fee_lamports).toBeUndefined();
  });

  it("does not recommend protected send when already protected", () => {
    // Trade is protected but has wide slippage → only slippage recommendation
    const result = evaluateTrade(makeTrade({ slippage_bps: 150, send_mode: "protected" }));
    expect(result.policy.recommended_send_mode).toBeUndefined();
    expect(result.policy.recommended_slippage_bps).toBe(75);
  });
});

// --- Token risk (Rugcheck) ---

describe("token risk rule", () => {
  it("blocks on extreme output token risk score", () => {
    const liveContext = {
      rugcheck_output: {
        score: 95,
        risks: [{ name: "Freeze authority enabled", level: "danger", description: "Token can be frozen.", score: 40 }],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);

    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("block");
    expect(result.recommendation).toContain("safety");
    expect(result.reason).toContain("Rugcheck risk score");
  });

  it("blocks on extreme input token risk score (sell-side)", () => {
    const liveContext = {
      rugcheck_input: {
        score: 90,
        risks: [{ name: "Rug pull detected", level: "danger", description: "Token rugged.", score: 90 }],
      },
      rugcheck_output: {
        score: 5,
        risks: [],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);

    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("Input");
  });

  it("warns on elevated token risk score", () => {
    const liveContext = {
      rugcheck_output: {
        score: 55,
        risks: [{ name: "Top holders own majority", level: "warning", description: "Concentrated ownership.", score: 20 }],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);

    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("warn");
  });

  it("does not trigger on low token risk score", () => {
    const liveContext = {
      rugcheck_output: {
        score: 15,
        risks: [],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);

    expect(result.triggered_rules).not.toContain("token_safety");
    expect(result.decision).toBe("allow");
  });

  it("skips gracefully when no rugcheck data (fail open)", () => {
    const result = evaluateTrade(makeTrade());

    const tokenDetail = result.rule_details.find((r) => r.rule_id === "token_safety");
    expect(tokenDetail).toBeDefined();
    expect(tokenDetail?.triggered).toBe(false);
    expect(tokenDetail?.message).toContain("skipped");
  });

  it("upgrades confidence to high when rugcheck data is present", () => {
    const liveContext = {
      rugcheck_output: { score: 10, risks: [] },
    };

    const result = evaluateTrade(makeTrade(), liveContext);

    expect(result.confidence).toBe("high");
    expect(result.live_sources).toContain("rugcheck");
  });

  it("reports live_sources correctly for jupiter", () => {
    const liveContext = {
      jupiter: { priceImpactPct: 0.1, outAmount: "100", routeCount: 1 },
    };

    const result = evaluateTrade(makeTrade(), liveContext);

    expect(result.live_sources).toContain("jupiter");
    expect(result.live_sources).not.toContain("rugcheck");
  });

  it("reports live_sources correctly when both providers present", () => {
    const liveContext = {
      jupiter: { priceImpactPct: 0.1, outAmount: "100", routeCount: 1 },
      rugcheck_output: { score: 10, risks: [] },
    };

    const result = evaluateTrade(makeTrade(), liveContext);

    expect(result.live_sources).toContain("jupiter");
    expect(result.live_sources).toContain("rugcheck");
  });

  it("does not emit safer parameters for token risk (problem is the token, not settings)", () => {
    const liveContext = {
      rugcheck_output: {
        score: 90,
        risks: [{ name: "Rug pull detected", level: "danger", description: "Token rugged.", score: 90 }],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);

    expect(result.decision).toBe("block");
    // Token risk should not add parameter recommendations
    expect(result.policy.recommended_slippage_bps).toBeUndefined();
    expect(result.policy.recommended_send_mode).toBeUndefined();
    expect(result.policy.recommended_priority_fee_lamports).toBeUndefined();
  });

  // --- Normalized score thresholds (real-world examples) ---

  it("does not trigger for BONK-like normalized score (7/100)", () => {
    const liveContext = {
      rugcheck_output: { score: 7, scoreRaw: 101, risks: [] },
    };
    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).not.toContain("token_safety");
    expect(result.decision).toBe("allow");
  });

  it("does not trigger for RAY-like normalized score (38/100)", () => {
    const liveContext = {
      rugcheck_output: { score: 38, scoreRaw: 4110, risks: [] },
    };
    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).not.toContain("token_safety");
    expect(result.decision).toBe("allow");
  });

  it("warns for ORCA-like normalized score (72/100)", () => {
    const liveContext = {
      rugcheck_output: { score: 72, scoreRaw: 51671, risks: [] },
    };
    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("warn");
    // Should warn, not block — 72 is above warn (40) but below block (80)
    const detail = result.rule_details.find(r => r.rule_id === "token_safety");
    expect(detail?.severity).toBe("caution");
  });

  it("still blocks for extreme normalized score (95/100)", () => {
    const liveContext = {
      rugcheck_output: { score: 95, scoreRaw: 100000, risks: [] },
    };
    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("block");
  });

  it("includes 7 rules in rule_details", () => {
    const result = evaluateTrade(makeTrade());

    expect(result.rule_details).toHaveLength(8);
  });

  it("reports policy version 0.5.0", () => {
    const result = evaluateTrade(makeTrade());

    expect(result.policy_version).toBe("0.5.0");
  });
});

// --- Degraded mode ---

describe("degraded mode", () => {
  function makeMeta(overrides: Partial<LiveContextMeta> = {}): LiveContextMeta {
    return {
      attempted: [],
      succeeded: [],
      failed: [],
      source_detail: [],
      ...overrides,
    };
  }

  it("degraded is false when no meta is provided (backward compat)", () => {
    const result = evaluateTrade(makeTrade());
    expect(result.degraded).toBe(false);
    expect(result.degraded_reasons).toEqual([]);
  });

  it("degraded is false when all sources succeed", () => {
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input", "rugcheck:output", "jupiter-shield"],
      succeeded: ["jupiter", "rugcheck:input", "rugcheck:output", "jupiter-shield"],
      failed: [],
    });
    const result = evaluateTrade(makeTrade(), {}, meta);
    expect(result.degraded).toBe(false);
    expect(result.degraded_reasons).toEqual([]);
  });

  it("degraded is true when one source times out", () => {
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input", "rugcheck:output"],
      succeeded: ["jupiter", "rugcheck:input"],
      failed: [{ source: "rugcheck:output", status: "timeout" }],
    });
    const result = evaluateTrade(makeTrade(), {}, meta);
    expect(result.degraded).toBe(true);
    expect(result.degraded_reasons).toEqual([
      { source: "rugcheck:output", status: "timeout" },
    ]);
  });

  it("degraded is true when all sources fail", () => {
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input", "rugcheck:output"],
      succeeded: [],
      failed: [
        { source: "jupiter", status: "error" },
        { source: "rugcheck:input", status: "timeout" },
        { source: "rugcheck:output", status: "timeout" },
      ],
    });
    const result = evaluateTrade(makeTrade(), undefined, meta);
    expect(result.degraded).toBe(true);
    expect(result.degraded_reasons).toHaveLength(3);
  });

  it("degraded is false when all sources are skipped (no API keys)", () => {
    const meta = makeMeta({
      attempted: [],
      succeeded: [],
      failed: [],
      source_detail: [
        { source: "jupiter", status: "skipped", elapsed_ms: 0, fields_returned: [] },
        { source: "rugcheck:input", status: "skipped", elapsed_ms: 0, fields_returned: [] },
      ],
    });
    const result = evaluateTrade(makeTrade(), undefined, meta);
    expect(result.degraded).toBe(false);
  });

  it("escalates to warn when critical token source fails for unknown/meme tokens", () => {
    // SOL→BONK trade, rugcheck:output failed → can't trust the allow for meme token
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input", "rugcheck:output"],
      succeeded: ["jupiter", "rugcheck:input"],
      failed: [{ source: "rugcheck:output", status: "timeout" }],
    });
    const liveContext = {
      jupiter: { priceImpactPct: 0.1, outAmount: "100", routeCount: 1 },
      rugcheck_input: { score: 5, risks: [] },
    };
    const result = evaluateTrade(makeTrade({ output_mint: BONK_MINT }), liveContext, meta);
    expect(result.degraded).toBe(true);
    expect(result.decision).toBe("warn");
    expect(result.risk_level).toBe("caution");
    expect(result.reason).toContain("rugcheck:output");
    expect(result.reason).toContain("unavailable");
    expect(result.recommendation).toContain("caution");
  });

  it("does NOT escalate for known-safe pairs (SOL→USDC) even if critical source fails", () => {
    // SOL→USDC is stable/major — rugcheck being down shouldn't block this
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input", "rugcheck:output"],
      succeeded: ["jupiter", "rugcheck:input"],
      failed: [{ source: "rugcheck:output", status: "timeout" }],
    });
    const liveContext = {
      jupiter: { priceImpactPct: 0.1, outAmount: "100", routeCount: 1 },
      rugcheck_input: { score: 5, risks: [] },
    };
    const result = evaluateTrade(makeTrade(), liveContext, meta);
    expect(result.degraded).toBe(true);  // still honestly degraded
    expect(result.decision).toBe("allow"); // but not escalated for safe pair
  });

  it("escalates to warn when jupiter-shield fails for unknown tokens", () => {
    const meta = makeMeta({
      attempted: ["jupiter", "jupiter-shield"],
      succeeded: ["jupiter"],
      failed: [{ source: "jupiter-shield", status: "error" }],
    });
    const liveContext = {
      jupiter: { priceImpactPct: 0.1, outAmount: "100", routeCount: 1 },
    };
    const result = evaluateTrade(makeTrade({ output_mint: BONK_MINT }), liveContext, meta);
    expect(result.degraded).toBe(true);
    expect(result.decision).toBe("warn");
  });

  it("does not escalate when non-critical source fails", () => {
    // jupiter-tokens:input is not a critical token safety source
    const meta = makeMeta({
      attempted: ["jupiter", "jupiter-tokens:input", "rugcheck:input", "rugcheck:output"],
      succeeded: ["jupiter", "rugcheck:input", "rugcheck:output"],
      failed: [{ source: "jupiter-tokens:input", status: "error" }],
    });
    const liveContext = {
      jupiter: { priceImpactPct: 0.1, outAmount: "100", routeCount: 1 },
      rugcheck_input: { score: 5, risks: [] },
      rugcheck_output: { score: 5, risks: [] },
    };
    const result = evaluateTrade(makeTrade(), liveContext, meta);
    expect(result.degraded).toBe(true); // still degraded (a source failed)
    expect(result.decision).toBe("allow"); // but not escalated (non-critical)
  });

  it("does not double-escalate when rules already trigger", () => {
    // Trade already triggers warn from slippage, and critical source also failed
    const meta = makeMeta({
      attempted: ["rugcheck:output"],
      succeeded: [],
      failed: [{ source: "rugcheck:output", status: "timeout" }],
    });
    const result = evaluateTrade(makeTrade({ slippage_bps: 150 }), undefined, meta);
    expect(result.degraded).toBe(true);
    expect(result.decision).toBe("warn"); // was already warn from slippage
    expect(result.risk_level).toBe("caution"); // not escalated to high
    // reason comes from the slippage rule, not degraded messaging
    expect(result.reason).toContain("lippage");
  });

  it("rugcheck:input failure also triggers critical escalation for non-safe tokens", () => {
    const meta = makeMeta({
      attempted: ["rugcheck:input"],
      succeeded: [],
      failed: [{ source: "rugcheck:input", status: "error" }],
    });
    const result = evaluateTrade(makeTrade({ input_mint: BONK_MINT }), undefined, meta);
    expect(result.decision).toBe("warn");
  });
});

// --- Evidence payloads ---

describe("evidence payloads", () => {
  it("slippage rule includes thresholds and current value", () => {
    const result = evaluateTrade(makeTrade({ slippage_bps: 150 }));
    const detail = result.rule_details.find((r) => r.rule_id === "slippage_too_wide");
    expect(detail?.evidence).toEqual({
      current_bps: 150,
      threshold_caution: 100,
      threshold_high: 300,
    });
  });

  it("send mode rule includes current and recommended mode", () => {
    const result = evaluateTrade(makeTrade({ send_mode: "standard" }));
    const detail = result.rule_details.find((r) => r.rule_id === "unprotected_send_mode");
    expect(detail?.evidence).toEqual({
      current_mode: "standard",
      recommended_mode: "protected",
    });
  });

  it("size risk rule includes trade params and trigger reason", () => {
    const result = evaluateTrade(makeTrade({ amount_in: 15, slippage_bps: 150 }));
    const detail = result.rule_details.find((r) => r.rule_id === "large_trade_loose_settings");
    expect(detail?.evidence).toMatchObject({
      amount_in: 15,
      slippage_bps: 150,
      trigger: "large_wide_slippage",
    });
  });

  it("missing fields rule includes which fields are missing", () => {
    const result = evaluateTrade(makeTrade({ priority_fee_lamports: undefined }));
    const detail = result.rule_details.find((r) => r.rule_id === "missing_execution_params");
    expect(detail?.evidence).toEqual({ missing: ["priority_fee_lamports"] });
  });

  it("unsafe combination rule includes all three factors", () => {
    const result = evaluateTrade(makeTrade({ amount_in: 20, slippage_bps: 200, send_mode: "standard" }));
    const detail = result.rule_details.find((r) => r.rule_id === "unsafe_combination");
    expect(detail?.evidence).toMatchObject({
      factors: ["large_trade", "wide_slippage", "unprotected_send"],
    });
  });

  it("price impact rule includes impact and thresholds", () => {
    const liveContext = {
      jupiter: { priceImpactPct: 2.5, outAmount: "100", routeCount: 1 },
    };
    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "high_price_impact");
    expect(detail?.evidence).toEqual({
      price_impact_pct: 2.5,
      threshold_caution: 1,
      threshold_high: 5,
    });
  });

  it("token safety rule includes rugcheck scores and shield warnings", () => {
    const liveContext = {
      rugcheck_output: {
        score: 55,
        risks: [{ name: "Concentrated", level: "warning", description: ".", score: 20 }],
      },
    };
    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "token_safety");
    expect(detail?.evidence).toMatchObject({
      rugcheck_output_score: 55,
      rugcheck_input_score: null,
      input_verified: null,
      output_verified: null,
      output_organic_score: null,
      output_bot_holders_pct: null,
    });
  });

  it("token safety evidence includes Tokens V2 fields when available", () => {
    const liveContext = {
      jupiter_token_output: {
        mint: BONK_MINT,
        isVerified: false,
        organicScore: 10,
        audit: { botHoldersPercentage: 45 },
      },
      jupiter_token_input: {
        mint: SOL_MINT,
        isVerified: true,
      },
    };
    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "token_safety");
    expect(detail?.evidence).toMatchObject({
      input_verified: true,
      output_verified: false,
      output_organic_score: 10,
      output_bot_holders_pct: 45,
    });
  });

  it("liquidity depth rule includes liquidity and trigger type", () => {
    const liveContext = {
      jupiter_token_output: {
        mint: TOKEN_MINTS["USDC"],
        symbol: "USDC",
        isVerified: true,
        organicScore: 99,
        liquidity: 500,
      },
    };
    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "low_liquidity");
    expect(detail?.evidence).toMatchObject({
      weaker_liquidity_usd: 500,
      weaker_symbol: "USDC",
      weaker_side: "output",
      trigger: "below_block_floor",
    });
  });

  it("non-triggered rules have no evidence", () => {
    const result = evaluateTrade(makeTrade());
    const slippage = result.rule_details.find((r) => r.rule_id === "slippage_too_wide");
    expect(slippage?.triggered).toBe(false);
    expect(slippage?.evidence).toBeUndefined();
  });
});

// --- Proportional confidence ---

describe("proportional confidence", () => {
  function makeMeta(overrides: Partial<LiveContextMeta> = {}): LiveContextMeta {
    return { attempted: [], succeeded: [], failed: [], source_detail: [], ...overrides };
  }

  it("returns high when all attempted sources succeed (6/6 = 100%)", () => {
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input", "rugcheck:output", "jupiter-shield", "jupiter-tokens:input", "jupiter-tokens:output"],
      succeeded: ["jupiter", "rugcheck:input", "rugcheck:output", "jupiter-shield", "jupiter-tokens:input", "jupiter-tokens:output"],
    });
    const result = evaluateTrade(makeTrade(), {}, meta);
    expect(result.confidence).toBe("high");
  });

  it("returns high when 5/6 succeed (83% >= 75%)", () => {
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input", "rugcheck:output", "jupiter-shield", "jupiter-tokens:input", "jupiter-tokens:output"],
      succeeded: ["jupiter", "rugcheck:input", "rugcheck:output", "jupiter-shield", "jupiter-tokens:input"],
      failed: [{ source: "jupiter-tokens:output", status: "error" }],
    });
    const result = evaluateTrade(makeTrade(), {}, meta);
    expect(result.confidence).toBe("high");
  });

  it("returns medium when 2/6 succeed (33% — between 25% and 75%)", () => {
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input", "rugcheck:output", "jupiter-shield", "jupiter-tokens:input", "jupiter-tokens:output"],
      succeeded: ["jupiter", "rugcheck:input"],
      failed: [
        { source: "rugcheck:output", status: "timeout" },
        { source: "jupiter-shield", status: "error" },
        { source: "jupiter-tokens:input", status: "error" },
        { source: "jupiter-tokens:output", status: "error" },
      ],
    });
    const result = evaluateTrade(makeTrade(), {}, meta);
    expect(result.confidence).toBe("medium");
  });

  it("returns low when 1/6 succeed (17% < 25%)", () => {
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input", "rugcheck:output", "jupiter-shield", "jupiter-tokens:input", "jupiter-tokens:output"],
      succeeded: ["jupiter"],
      failed: [
        { source: "rugcheck:input", status: "timeout" },
        { source: "rugcheck:output", status: "timeout" },
        { source: "jupiter-shield", status: "error" },
        { source: "jupiter-tokens:input", status: "error" },
        { source: "jupiter-tokens:output", status: "error" },
      ],
    });
    const result = evaluateTrade(makeTrade(), {}, meta);
    expect(result.confidence).toBe("low");
  });

  it("returns low when 0/6 succeed (all fail)", () => {
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input", "rugcheck:output", "jupiter-shield", "jupiter-tokens:input", "jupiter-tokens:output"],
      succeeded: [],
      failed: [
        { source: "jupiter", status: "timeout" },
        { source: "rugcheck:input", status: "timeout" },
        { source: "rugcheck:output", status: "timeout" },
        { source: "jupiter-shield", status: "error" },
        { source: "jupiter-tokens:input", status: "error" },
        { source: "jupiter-tokens:output", status: "error" },
      ],
    });
    const result = evaluateTrade(makeTrade(), undefined, meta);
    expect(result.confidence).toBe("low");
  });

  it("returns medium when no sources attempted (static-only deployment)", () => {
    const meta = makeMeta({ attempted: [], succeeded: [], failed: [] });
    const result = evaluateTrade(makeTrade(), undefined, meta);
    expect(result.confidence).toBe("medium");
  });

  it("falls back to old logic when no meta provided", () => {
    // With live data but no meta → backward compat → "high"
    const liveContext = { jupiter: { priceImpactPct: 0.1, outAmount: "100", routeCount: 1 } };
    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.confidence).toBe("high");

    // Without live data and no meta → "medium"
    const result2 = evaluateTrade(makeTrade());
    expect(result2.confidence).toBe("medium");
  });
});

// --- Provenance ---

describe("provenance", () => {
  function makeMeta(overrides: Partial<LiveContextMeta> = {}): LiveContextMeta {
    return { attempted: [], succeeded: [], failed: [], source_detail: [], ...overrides };
  }

  it("returns empty provenance when no meta provided", () => {
    const result = evaluateTrade(makeTrade());
    expect(result.provenance).toEqual([]);
  });

  it("maps source_detail to provenance entries", () => {
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input"],
      succeeded: ["jupiter", "rugcheck:input"],
      source_detail: [
        { source: "jupiter", status: "ok", elapsed_ms: 120, fields_returned: ["jupiter"] },
        { source: "rugcheck:input", status: "ok", elapsed_ms: 80, fields_returned: ["rugcheck_input"] },
        { source: "rugcheck:output", status: "skipped", elapsed_ms: 0, fields_returned: [] },
      ],
    });
    const result = evaluateTrade(makeTrade(), {}, meta);
    expect(result.provenance).toHaveLength(3);
    expect(result.provenance[0]).toEqual({
      source: "jupiter", status: "ok", elapsed_ms: 120, fields_used: ["jupiter"],
    });
    expect(result.provenance[2]).toEqual({
      source: "rugcheck:output", status: "skipped", elapsed_ms: 0, fields_used: [],
    });
  });

  it("includes failed sources in provenance with error/timeout status", () => {
    const meta = makeMeta({
      attempted: ["jupiter"],
      succeeded: [],
      failed: [{ source: "jupiter", status: "timeout" }],
      source_detail: [
        { source: "jupiter", status: "timeout", elapsed_ms: 3000, fields_returned: [] },
      ],
    });
    const result = evaluateTrade(makeTrade(), undefined, meta);
    expect(result.provenance[0]).toEqual({
      source: "jupiter", status: "timeout", elapsed_ms: 3000, fields_used: [],
    });
  });

  it("derives live_sources from provenance (collapsed to provider level)", () => {
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input", "rugcheck:output"],
      succeeded: ["jupiter", "rugcheck:input", "rugcheck:output"],
      source_detail: [
        { source: "jupiter", status: "ok", elapsed_ms: 100, fields_returned: ["jupiter"] },
        { source: "rugcheck:input", status: "ok", elapsed_ms: 80, fields_returned: ["rugcheck_input"] },
        { source: "rugcheck:output", status: "ok", elapsed_ms: 90, fields_returned: ["rugcheck_output"] },
      ],
    });
    const liveContext = {
      jupiter: { priceImpactPct: 0.1, outAmount: "100", routeCount: 1 },
      rugcheck_input: { score: 5, risks: [] as never[] },
      rugcheck_output: { score: 5, risks: [] as never[] },
    };
    const result = evaluateTrade(makeTrade(), liveContext, meta);
    // "rugcheck:input" and "rugcheck:output" collapse to "rugcheck"
    expect(result.live_sources).toContain("jupiter");
    expect(result.live_sources).toContain("rugcheck");
    expect(result.live_sources).toHaveLength(2);
  });

  it("excludes failed sources from live_sources", () => {
    const meta = makeMeta({
      attempted: ["jupiter", "rugcheck:input"],
      succeeded: ["jupiter"],
      failed: [{ source: "rugcheck:input", status: "error" }],
      source_detail: [
        { source: "jupiter", status: "ok", elapsed_ms: 100, fields_returned: ["jupiter"] },
        { source: "rugcheck:input", status: "error", elapsed_ms: 50, fields_returned: [] },
      ],
    });
    const result = evaluateTrade(makeTrade(), { jupiter: { priceImpactPct: 0.1, outAmount: "100", routeCount: 1 } }, meta);
    expect(result.live_sources).toContain("jupiter");
    expect(result.live_sources).not.toContain("rugcheck");
  });

  it("excludes skipped sources from live_sources", () => {
    const meta = makeMeta({
      attempted: [],
      succeeded: [],
      source_detail: [
        { source: "jupiter", status: "skipped", elapsed_ms: 0, fields_returned: [] },
        { source: "rugcheck:input", status: "skipped", elapsed_ms: 0, fields_returned: [] },
      ],
    });
    const result = evaluateTrade(makeTrade(), undefined, meta);
    expect(result.live_sources).toEqual([]);
  });
});

// --- Version consistency ---

describe("version consistency", () => {
  it("policy_version matches VERSION constant", () => {
    const result = evaluateTrade(makeTrade());
    expect(result.policy_version).toBe(VERSION);
  });
});

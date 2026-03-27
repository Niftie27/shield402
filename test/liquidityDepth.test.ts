import { describe, it, expect } from "vitest";
import { evaluateTrade } from "../src/rules/index";
import type { ValidatedTradeCheck } from "../src/schema/checkTradeSchema";
import type { LiveContext } from "../src/data/liveContext";
import { SOL_MINT, TOKEN_MINTS } from "../src/data/mints";

const USDC_MINT = TOKEN_MINTS["USDC"];

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

describe("liquidityDepthRule", () => {
  it("skips when no token liquidity data (fail open)", () => {
    const result = evaluateTrade(makeTrade());
    const detail = result.rule_details.find((r) => r.rule_id === "low_liquidity");

    expect(detail?.triggered).toBe(false);
    expect(detail?.message).toContain("skipped");
  });

  it("blocks when liquidity is exactly 0 (not skipped as missing data)", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "DEAD",
        liquidity: 0,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("low_liquidity");
    expect(result.decision).toBe("block");
    const detail = result.rule_details.find((r) => r.rule_id === "low_liquidity");
    expect(detail?.severity).toBe("high");
    expect(detail?.message).toContain("Extremely thin liquidity on DEAD");
  });

  it("blocks on extremely low liquidity (<$1K)", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "SCAM",
        liquidity: 500,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("low_liquidity");
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("Extremely thin liquidity");
  });

  it("warns on thin liquidity ($1K-$10K)", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "MICRO",
        liquidity: 5_000,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("low_liquidity");
    expect(result.decision).toBe("warn");
    expect(result.reason).toContain("Thin liquidity");
  });

  it("passes on adequate liquidity with no price impact", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "GOOD",
        liquidity: 1_000_000,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "low_liquidity");
    expect(detail?.triggered).toBe(false);
    expect(detail?.message).toContain("Adequate");
  });

  it("warns on moderate price impact + low liquidity cross-check", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "THIN",
        liquidity: 50_000,
      },
      jupiter: {
        priceImpactPct: 1.5,
        outAmount: "100",
        routeCount: 1,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("low_liquidity");
    expect(result.decision).toBe("warn");
    // Low liquidity detail should mention price impact
    const detail = result.rule_details.find((r) => r.rule_id === "low_liquidity");
    expect(detail?.triggered).toBe(true);
    expect(detail?.message).toContain("price impact");
  });

  it("blocks on high price impact + low liquidity", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "DANGER",
        liquidity: 200_000,
      },
      jupiter: {
        priceImpactPct: 3.0,
        outAmount: "100",
        routeCount: 1,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("low_liquidity");
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("significantly exceeds");
  });

  it("blocks (not warns) when both price impact branches overlap", () => {
    // Regression: liquidity=80K is below both 100K and 500K thresholds,
    // priceImpactPct=3.0 is above both 0.5 and 2.0.
    // The high branch must be checked first so this doesn't downgrade to caution.
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "OVERLAP",
        liquidity: 80_000,
      },
      jupiter: {
        priceImpactPct: 3.0,
        outAmount: "100",
        routeCount: 1,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "low_liquidity");
    expect(detail?.triggered).toBe(true);
    expect(detail?.severity).toBe("high");
    expect(detail?.message).toContain("significantly exceeds");
  });

  it("does not trigger when liquidity is high even with price impact", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "DEEP",
        liquidity: 10_000_000,
      },
      jupiter: {
        priceImpactPct: 0.8,
        outAmount: "100",
        routeCount: 1,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "low_liquidity");
    expect(detail?.triggered).toBe(false);
  });

  it("uses output token symbol in messages", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "PUMP",
        liquidity: 300,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.reason).toContain("PUMP");
  });

  it("falls back to 'output token' when symbol is missing", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        liquidity: 400,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.reason).toContain("output token");
  });

  it("reports recommendation for liquidity issues", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "LOW",
        liquidity: 800,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.recommendation).toContain("liquidity");
  });

  // --- Both-sides behavior ---

  it("shows both sides in pair summary when both available", () => {
    const liveContext: LiveContext = {
      jupiter_token_input: {
        mint: SOL_MINT,
        symbol: "JUP",
        liquidity: 2_000_000,
      },
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "USDC",
        liquidity: 500_000_000,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "low_liquidity");
    expect(detail?.triggered).toBe(false);
    expect(detail?.message).toContain("Input JUP");
    expect(detail?.message).toContain("Output USDC");
    expect(detail?.message).toContain("Adequate");
    expect(detail?.message).toContain("Weaker side: JUP");
  });

  it("reports input token in triggered warning when it has lower liquidity", () => {
    const liveContext: LiveContext = {
      jupiter_token_input: {
        mint: SOL_MINT,
        symbol: "THINPUT",
        liquidity: 3_000,
      },
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "USDC",
        liquidity: 500_000_000,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "low_liquidity");
    expect(detail?.triggered).toBe(true);
    // Both sides shown in pair summary
    expect(detail?.message).toContain("Input THINPUT");
    expect(detail?.message).toContain("Output USDC");
    // Warning specifically calls out the weak side
    expect(detail?.message).toContain("Thin liquidity on THINPUT");
  });

  it("uses only available side when other side has no data", () => {
    const liveContext: LiveContext = {
      jupiter_token_input: {
        mint: SOL_MINT,
        symbol: "ONLY",
        liquidity: 50_000,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "low_liquidity");
    expect(detail?.triggered).toBe(false);
    expect(detail?.message).toContain("ONLY");
    // Should NOT have "Weaker side:" when only one side
    expect(detail?.message).not.toContain("Weaker side");
  });

  it("includes full both-sides evidence", () => {
    const liveContext: LiveContext = {
      jupiter_token_input: {
        mint: SOL_MINT,
        symbol: "JUP",
        liquidity: 2_000_000,
      },
      jupiter_token_output: {
        mint: USDC_MINT,
        symbol: "USDC",
        liquidity: 500_000_000,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "low_liquidity");
    const ev = detail?.evidence as Record<string, unknown>;
    expect(ev.input_symbol).toBe("JUP");
    expect(ev.input_liquidity_usd).toBe(2_000_000);
    expect(ev.output_symbol).toBe("USDC");
    expect(ev.output_liquidity_usd).toBe(500_000_000);
    expect(ev.weaker_side).toBe("input");
    expect(ev.weaker_symbol).toBe("JUP");
    expect(ev.weaker_liquidity_usd).toBe(2_000_000);
  });
});

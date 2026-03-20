import { describe, it, expect } from "vitest";
import { evaluateTrade } from "../src/rules/index";
import type { ValidatedTradeCheck } from "../src/schema/checkTradeSchema";
import type { LiveContext } from "../src/data/liveContext";
import { SOL_MINT, TOKEN_MINTS } from "../src/data/mints";

const USDC_MINT = TOKEN_MINTS["USDC"];
const BONK_MINT = TOKEN_MINTS["BONK"];

// A plausible unknown token mint (not in the category map)
const UNKNOWN_MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

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

// --- Jupiter Shield warnings ---

describe("tokenSafetyRule — Jupiter Shield", () => {
  it("blocks on NOT_SELLABLE (honeypot)", () => {
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: USDC_MINT,
        warnings: [{ type: "NOT_SELLABLE", message: "Token cannot be sold", severity: "critical" }],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("NOT_SELLABLE");
  });

  it("blocks on NON_TRANSFERABLE", () => {
    const liveContext: LiveContext = {
      jupiter_shield_input: {
        mint: SOL_MINT,
        warnings: [{ type: "NON_TRANSFERABLE", message: "Token is non-transferable", severity: "critical" }],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("block");
  });

  it("warns on HAS_MINT_AUTHORITY for unknown tokens", () => {
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: UNKNOWN_MINT,
        warnings: [{ type: "HAS_MINT_AUTHORITY", message: "Mint authority enabled", severity: "info" }],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("warn");
  });

  it("warns on HAS_FREEZE_AUTHORITY for unknown tokens", () => {
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: UNKNOWN_MINT,
        warnings: [{ type: "HAS_FREEZE_AUTHORITY", message: "Freeze authority enabled", severity: "info" }],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("warn");
  });

  it("does not trigger on INFO-only warnings but surfaces them in message", () => {
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: USDC_MINT,
        warnings: [{ type: "NOT_VERIFIED", message: "Token not verified", severity: "info" }],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "token_safety");
    // INFO warnings don't escalate severity — rule stays low/not triggered
    expect(detail?.triggered).toBe(false);
    expect(detail?.severity).toBe("low");
    // But the INFO finding is surfaced in the message, not silently dropped
    expect(detail?.message).toContain("Noted:");
    expect(detail?.message).toContain("NOT_VERIFIED");
  });

  it("surfaces multiple INFO warnings without triggering", () => {
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: USDC_MINT,
        warnings: [
          { type: "NOT_VERIFIED", message: "Token not verified", severity: "info" },
          { type: "NEW_LISTING", message: "Recently listed token", severity: "info" },
        ],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "token_safety");
    expect(detail?.triggered).toBe(false);
    expect(detail?.message).toContain("NOT_VERIFIED");
    expect(detail?.message).toContain("NEW_LISTING");
  });

  it("uses highest severity when multiple warnings present", () => {
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: UNKNOWN_MINT,
        warnings: [
          { type: "HAS_MINT_AUTHORITY", message: "Mint authority enabled", severity: "info" },
          { type: "NOT_SELLABLE", message: "Cannot sell", severity: "critical" },
        ],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.decision).toBe("block");
  });

  it("checks both input and output Shield warnings", () => {
    const liveContext: LiveContext = {
      jupiter_shield_input: {
        mint: SOL_MINT,
        warnings: [],
      },
      jupiter_shield_output: {
        mint: USDC_MINT,
        warnings: [{ type: "HAS_PERMANENT_DELEGATE", message: "Permanent delegate set", severity: "warning" }],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.reason).toContain("Output");
  });

  it("passes when Shield returns empty warnings", () => {
    const liveContext: LiveContext = {
      jupiter_shield_input: { mint: SOL_MINT, warnings: [] },
      jupiter_shield_output: { mint: USDC_MINT, warnings: [] },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "token_safety");
    expect(detail?.triggered).toBe(false);
    expect(detail?.message).toContain("passed");
  });
});

// --- Jupiter Tokens V2 flags ---

describe("tokenSafetyRule — Tokens V2", () => {
  it("warns when output token is not verified", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        isVerified: false,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.reason).toContain("not verified");
  });

  it("warns on low organic score", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        isVerified: true,
        organicScore: 5,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.reason).toContain("organic activity");
  });

  it("warns on high bot holder percentage", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        isVerified: true,
        organicScore: 80,
        audit: { botHoldersPercentage: 45 },
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.reason).toContain("bot holders");
  });

  it("warns when input token is not verified", () => {
    const liveContext: LiveContext = {
      jupiter_token_input: {
        mint: SOL_MINT,
        isVerified: false,
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.reason).toContain("Input token is not verified");
  });

  it("does not trigger on healthy Tokens V2 data", () => {
    const liveContext: LiveContext = {
      jupiter_token_output: {
        mint: USDC_MINT,
        isVerified: true,
        organicScore: 90,
        audit: { botHoldersPercentage: 5 },
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).not.toContain("token_safety");
  });
});

// --- Combined sources ---

describe("tokenSafetyRule — multi-source", () => {
  it("combines Shield + Rugcheck into highest severity", () => {
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: UNKNOWN_MINT,
        warnings: [{ type: "HAS_MINT_AUTHORITY", message: "Mint authority", severity: "info" }],
      },
      rugcheck_output: { score: 90, risks: [] },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    // Rugcheck 90 = high, Shield WARN = caution → high wins
    expect(result.decision).toBe("block");
  });

  it("reports all live sources correctly", () => {
    const liveContext: LiveContext = {
      jupiter_shield_output: { mint: USDC_MINT, warnings: [] },
      jupiter_token_output: { mint: USDC_MINT, isVerified: true, organicScore: 90 },
      rugcheck_output: { score: 10, risks: [] },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.live_sources).toContain("jupiter-shield");
    expect(result.live_sources).toContain("jupiter-tokens");
    expect(result.live_sources).toContain("rugcheck");
    expect(result.confidence).toBe("high");
  });
});

// --- Token category: stablecoin false-positive suppression ---

describe("tokenSafetyRule — token categories", () => {
  it("suppresses HAS_FREEZE_AUTHORITY + HAS_MINT_AUTHORITY for USDC (stable)", () => {
    // Real Jupiter Shield response for USDC — both warnings are structurally expected
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: USDC_MINT,
        warnings: [
          { type: "HAS_FREEZE_AUTHORITY", message: "Freeze authority enabled", severity: "warning" },
          { type: "HAS_MINT_AUTHORITY", message: "Mint authority enabled", severity: "info" },
        ],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    // Should NOT trigger — these are expected for a regulated stablecoin
    const detail = result.rule_details.find((r) => r.rule_id === "token_safety");
    expect(detail?.triggered).toBe(false);
    expect(detail?.severity).toBe("low");
    // But warnings are still noted in the message
    expect(detail?.message).toContain("expected for stable token");
  });

  it("suppresses HAS_FREEZE_AUTHORITY for USDT (stable)", () => {
    const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: USDT_MINT,
        warnings: [
          { type: "HAS_FREEZE_AUTHORITY", message: "Freeze authority enabled", severity: "warning" },
        ],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    const detail = result.rule_details.find((r) => r.rule_id === "token_safety");
    expect(detail?.triggered).toBe(false);
  });

  it("still warns on HAS_FREEZE_AUTHORITY for unknown tokens", () => {
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: UNKNOWN_MINT,
        warnings: [
          { type: "HAS_FREEZE_AUTHORITY", message: "Freeze authority enabled", severity: "warning" },
        ],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("warn");
  });

  it("still warns on HAS_MINT_AUTHORITY for meme tokens", () => {
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: BONK_MINT,
        warnings: [
          { type: "HAS_MINT_AUTHORITY", message: "Mint authority enabled", severity: "info" },
        ],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    // BONK is "meme" category — not stable, so mint authority is still a warning
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("warn");
  });

  it("does NOT suppress non-expected warnings for stable tokens", () => {
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: USDC_MINT,
        warnings: [
          { type: "HAS_PERMANENT_DELEGATE", message: "Permanent delegate set", severity: "warning" },
        ],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    // HAS_PERMANENT_DELEGATE is NOT in STABLE_EXPECTED_WARNINGS — still warns
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("warn");
  });

  it("still blocks on CRITICAL warnings for stable tokens", () => {
    const liveContext: LiveContext = {
      jupiter_shield_output: {
        mint: USDC_MINT,
        warnings: [
          { type: "NOT_SELLABLE", message: "Token cannot be sold", severity: "critical" },
        ],
      },
    };

    const result = evaluateTrade(makeTrade(), liveContext);
    // Critical warnings are never suppressed, regardless of category
    expect(result.triggered_rules).toContain("token_safety");
    expect(result.decision).toBe("block");
  });
});

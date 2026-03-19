import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { LiveContext } from "../data/liveContext";
import type { JupiterShieldWarning } from "../data/jupiterShield";
import type { Rule } from "./rule";

/**
 * Token safety rule — combines Jupiter Shield warnings, Rugcheck scores,
 * and Jupiter Tokens V2 audit data into a single verdict.
 *
 * Severity is CONTEXTUAL: the same warning (e.g. HAS_MINT_AUTHORITY)
 * maps to different severities depending on trade size. A $2 trade into
 * a token with mint authority is a warn; a $5000 trade is a block.
 *
 * Data sources (all fail-open):
 * - Jupiter Shield: 16 structured warnings (honeypot, mint/freeze authority, etc.)
 * - Rugcheck: aggregate risk score
 * - Jupiter Tokens V2: isVerified, organicScore, audit data
 */

/** Trade size thresholds for contextual severity. */
const SMALL_TRADE_AMOUNT = 10;   // ≤10 units of input token = "small"
const LARGE_TRADE_AMOUNT = 100;  // ≥100 units = "large"

/** Rugcheck thresholds (same as before). */
const RUGCHECK_BLOCK_THRESHOLD = 80;
const RUGCHECK_WARN_THRESHOLD = 40;

/** Jupiter Shield warning types that are always critical regardless of size. */
const ALWAYS_BLOCK: Set<string> = new Set([
  "NOT_SELLABLE",       // Honeypot — can buy but can't sell
  "NON_TRANSFERABLE",   // Can't move the token at all
]);

/** Warnings that escalate to block for large trades. */
const BLOCK_IF_LARGE: Set<string> = new Set([
  "HAS_MINT_AUTHORITY",       // Supply can be inflated
  "HAS_FREEZE_AUTHORITY",     // Accounts can be frozen
  "HAS_PERMANENT_DELEGATE",   // Tokens can be drained
  "HIGH_SUPPLY_CONCENTRATION", // Whale-dominated
]);

/** Warnings that are always at least a warn. */
const WARN_ALWAYS: Set<string> = new Set([
  "SUSPICIOUS_DEV_ACTIVITY",
  "SUSPICIOUS_TOP_HOLDER_ACTIVITY",
  "LOW_LIQUIDITY",
  "MUTABLE_TRANSFER_FEES",
  "VERY_LOW_TRADING_ACTIVITY",
]);

/** Informational warnings — flagged but don't trigger on their own. */
const INFO_ONLY: Set<string> = new Set([
  "NOT_VERIFIED",
  "NEW_LISTING",
  "LOW_ORGANIC_ACTIVITY",
  "HIGH_SINGLE_OWNERSHIP",
]);

export const tokenSafetyRule: Rule = {
  id: "token_safety",
  description: "Multi-source token safety assessment combining Jupiter Shield, Rugcheck, and Tokens V2 audit data.",

  evaluate(trade: ValidatedTradeCheck, liveContext?: LiveContext): RuleResult {
    const findings: string[] = [];
    let maxSeverity: "low" | "caution" | "high" = "low";

    const hasAnyData = !!(
      liveContext?.jupiter_shield_input ||
      liveContext?.jupiter_shield_output ||
      liveContext?.rugcheck_input ||
      liveContext?.rugcheck_output ||
      liveContext?.jupiter_token_input ||
      liveContext?.jupiter_token_output
    );

    if (!hasAnyData) {
      return {
        rule_id: "token_safety",
        triggered: false,
        severity: "low",
        message: "Token safety check skipped (no live data available).",
      };
    }

    const tradeSize = trade.amount_in;
    const isLarge = tradeSize >= LARGE_TRADE_AMOUNT;
    const isSmall = tradeSize <= SMALL_TRADE_AMOUNT;

    // --- Jupiter Shield warnings (input + output) ---
    const shieldInputWarnings = liveContext?.jupiter_shield_input?.warnings ?? [];
    const shieldOutputWarnings = liveContext?.jupiter_shield_output?.warnings ?? [];

    const inputSeverity = assessShieldWarnings(shieldInputWarnings, "Input", isLarge, isSmall, findings);
    const outputSeverity = assessShieldWarnings(shieldOutputWarnings, "Output", isLarge, isSmall, findings);

    maxSeverity = worstSeverity(maxSeverity, inputSeverity, outputSeverity);

    // --- Rugcheck scores (input + output) ---
    const rugInput = liveContext?.rugcheck_input;
    const rugOutput = liveContext?.rugcheck_output;

    if (rugInput) {
      const s = assessRugcheck(rugInput.score, "Input", findings);
      maxSeverity = worstSeverity(maxSeverity, s);
    }
    if (rugOutput) {
      const s = assessRugcheck(rugOutput.score, "Output", findings);
      maxSeverity = worstSeverity(maxSeverity, s);
    }

    // --- Jupiter Tokens V2 audit flags ---
    const tokenInput = liveContext?.jupiter_token_input;
    const tokenOutput = liveContext?.jupiter_token_output;

    if (tokenOutput) {
      // Unverified output token + not a tiny trade = warn
      if (tokenOutput.isVerified === false && !isSmall) {
        findings.push("Output token is not verified on Jupiter.");
        maxSeverity = worstSeverity(maxSeverity, "caution");
      }

      // Very low organic score = warn (bot-dominated trading)
      if (tokenOutput.organicScore !== undefined && tokenOutput.organicScore < 20) {
        findings.push(`Output token has very low organic activity (score: ${tokenOutput.organicScore.toFixed(0)}).`);
        maxSeverity = worstSeverity(maxSeverity, "caution");
      }

      // High bot holder percentage
      if (tokenOutput.audit?.botHoldersPercentage !== undefined && tokenOutput.audit.botHoldersPercentage > 30) {
        findings.push(`Output token has ${tokenOutput.audit.botHoldersPercentage.toFixed(0)}% bot holders.`);
        maxSeverity = worstSeverity(maxSeverity, "caution");
      }
    }

    if (tokenInput) {
      if (tokenInput.isVerified === false && !isSmall) {
        findings.push("Input token is not verified on Jupiter.");
        maxSeverity = worstSeverity(maxSeverity, "caution");
      }
    }

    // --- Build result ---
    if (maxSeverity === "low") {
      const sources = describeSources(liveContext);
      return {
        rule_id: "token_safety",
        triggered: false,
        severity: "low",
        message: `Token safety checks passed (${sources}).`,
      };
    }

    return {
      rule_id: "token_safety",
      triggered: true,
      severity: maxSeverity,
      message: findings.join(" "),
    };
  },
};

/**
 * Assess Jupiter Shield warnings for one side (input or output).
 * Severity depends on warning type AND trade size.
 */
function assessShieldWarnings(
  warnings: JupiterShieldWarning[],
  side: "Input" | "Output",
  isLarge: boolean,
  isSmall: boolean,
  findings: string[],
): "low" | "caution" | "high" {
  let severity: "low" | "caution" | "high" = "low";

  for (const w of warnings) {
    if (ALWAYS_BLOCK.has(w.type)) {
      findings.push(`${side}: ${w.message} [${w.type}]`);
      severity = "high";
      continue;
    }

    if (BLOCK_IF_LARGE.has(w.type)) {
      if (isLarge) {
        findings.push(`${side}: ${w.message} (large trade — elevated risk) [${w.type}]`);
        severity = worstSeverity(severity, "high");
      } else if (!isSmall) {
        findings.push(`${side}: ${w.message} [${w.type}]`);
        severity = worstSeverity(severity, "caution");
      }
      // Small trades: info only, don't add finding
      continue;
    }

    if (WARN_ALWAYS.has(w.type)) {
      findings.push(`${side}: ${w.message} [${w.type}]`);
      severity = worstSeverity(severity, "caution");
      continue;
    }

    if (INFO_ONLY.has(w.type)) {
      // Only add finding for non-small trades
      if (!isSmall) {
        findings.push(`${side}: ${w.message} [${w.type}]`);
      }
      // Don't escalate severity — info only
    }
  }

  return severity;
}

/** Assess Rugcheck score for one side. */
function assessRugcheck(
  score: number,
  side: "Input" | "Output",
  findings: string[],
): "low" | "caution" | "high" {
  if (score > RUGCHECK_BLOCK_THRESHOLD) {
    findings.push(`${side} token Rugcheck risk score is ${score} (extreme).`);
    return "high";
  }
  if (score > RUGCHECK_WARN_THRESHOLD) {
    findings.push(`${side} token Rugcheck risk score is ${score} (elevated).`);
    return "caution";
  }
  return "low";
}

/** Return the highest severity from a list of severities. */
function worstSeverity(...levels: Array<"low" | "caution" | "high">): "low" | "caution" | "high" {
  if (levels.includes("high")) return "high";
  if (levels.includes("caution")) return "caution";
  return "low";
}

/** Describe which token safety sources contributed. */
function describeSources(ctx?: LiveContext): string {
  const parts: string[] = [];
  if (ctx?.jupiter_shield_input || ctx?.jupiter_shield_output) parts.push("Jupiter Shield");
  if (ctx?.rugcheck_input || ctx?.rugcheck_output) parts.push("Rugcheck");
  if (ctx?.jupiter_token_input || ctx?.jupiter_token_output) parts.push("Tokens V2");
  return parts.length > 0 ? parts.join(", ") : "no sources";
}

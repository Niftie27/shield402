import type { ValidatedTradeCheck } from "../schema/checkTradeSchema";
import type { RuleResult } from "../types/result";
import type { LiveContext } from "../data/liveContext";
import type { JupiterShieldWarning } from "../data/jupiterShield";
import type { Rule } from "./rule";

/**
 * Token safety rule — combines Jupiter Shield warnings, Rugcheck scores,
 * and Jupiter Tokens V2 audit data into a single verdict.
 *
 * Severity is determined by warning type, not trade size. We cannot
 * reliably estimate USD value from amount_in (raw token units vary
 * across tokens — 100 BONK ≠ 100 SOL). Rather than pretend to be
 * dollar-contextual, the rule uses a clear tier model:
 *
 * - Critical warnings (honeypot, non-transferable) → block always
 * - Dangerous warnings (mint/freeze authority, permanent delegate) → warn
 * - Informational warnings (not verified, new listing) → noted but don't trigger
 *
 * Data sources (all fail-open):
 * - Jupiter Shield: 16 structured warnings (honeypot, mint/freeze authority, etc.)
 * - Rugcheck: aggregate risk score
 * - Jupiter Tokens V2: isVerified, organicScore, audit data
 */

/** Rugcheck thresholds. */
const RUGCHECK_BLOCK_THRESHOLD = 80;
const RUGCHECK_WARN_THRESHOLD = 40;

/**
 * Jupiter Shield warning severity tiers.
 *
 * Critical: these represent immediate, unconditional danger.
 * Warn: these represent structural risk the caller should know about.
 * Info: these are noted in the response but don't trigger the rule.
 */
const CRITICAL: Set<string> = new Set([
  "NOT_SELLABLE",       // Honeypot — can buy but can't sell
  "NON_TRANSFERABLE",   // Can't move the token at all
]);

const WARN: Set<string> = new Set([
  "HAS_MINT_AUTHORITY",              // Supply can be inflated
  "HAS_FREEZE_AUTHORITY",            // Accounts can be frozen
  "HAS_PERMANENT_DELEGATE",          // Tokens can be drained
  "HIGH_SUPPLY_CONCENTRATION",       // Whale-dominated
  "SUSPICIOUS_DEV_ACTIVITY",         // Dev wallet red flags
  "SUSPICIOUS_TOP_HOLDER_ACTIVITY",  // Top holders dumping
  "LOW_LIQUIDITY",                   // Can't trade meaningful amounts
  "MUTABLE_TRANSFER_FEES",           // Fee rug possible
  "VERY_LOW_TRADING_ACTIVITY",       // Nearly dead
]);

const INFO: Set<string> = new Set([
  "NOT_VERIFIED",
  "NEW_LISTING",
  "LOW_ORGANIC_ACTIVITY",
  "HIGH_SINGLE_OWNERSHIP",
]);

export const tokenSafetyRule: Rule = {
  id: "token_safety",
  description: "Multi-source token safety assessment combining Jupiter Shield, Rugcheck, and Tokens V2 audit data.",

  evaluate(_trade: ValidatedTradeCheck, liveContext?: LiveContext): RuleResult {
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

    // --- Jupiter Shield warnings (input + output) ---
    const shieldInputWarnings = liveContext?.jupiter_shield_input?.warnings ?? [];
    const shieldOutputWarnings = liveContext?.jupiter_shield_output?.warnings ?? [];

    const inputSeverity = assessShieldWarnings(shieldInputWarnings, "Input", findings);
    const outputSeverity = assessShieldWarnings(shieldOutputWarnings, "Output", findings);

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
    const tokenOutput = liveContext?.jupiter_token_output;
    const tokenInput = liveContext?.jupiter_token_input;

    if (tokenOutput) {
      if (tokenOutput.isVerified === false) {
        findings.push("Output token is not verified on Jupiter.");
        maxSeverity = worstSeverity(maxSeverity, "caution");
      }

      if (tokenOutput.organicScore !== undefined && tokenOutput.organicScore < 20) {
        findings.push(`Output token has very low organic activity (score: ${tokenOutput.organicScore.toFixed(0)}).`);
        maxSeverity = worstSeverity(maxSeverity, "caution");
      }

      if (tokenOutput.audit?.botHoldersPercentage !== undefined && tokenOutput.audit.botHoldersPercentage > 30) {
        findings.push(`Output token has ${tokenOutput.audit.botHoldersPercentage.toFixed(0)}% bot holders.`);
        maxSeverity = worstSeverity(maxSeverity, "caution");
      }
    }

    if (tokenInput) {
      if (tokenInput.isVerified === false) {
        findings.push("Input token is not verified on Jupiter.");
        maxSeverity = worstSeverity(maxSeverity, "caution");
      }
    }

    // --- Build result ---
    if (maxSeverity === "low") {
      const sources = describeSources(liveContext);
      // Surface INFO-only findings in the message so callers can see them,
      // but keep the rule non-triggering (severity stays low).
      if (findings.length > 0) {
        return {
          rule_id: "token_safety",
          triggered: false,
          severity: "low",
          message: `Token safety checks passed (${sources}). Noted: ${findings.join(" ")}`,
        };
      }
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
 * Severity is based on warning type alone — no trade-size escalation.
 */
function assessShieldWarnings(
  warnings: JupiterShieldWarning[],
  side: "Input" | "Output",
  findings: string[],
): "low" | "caution" | "high" {
  let severity: "low" | "caution" | "high" = "low";

  for (const w of warnings) {
    if (CRITICAL.has(w.type)) {
      findings.push(`${side}: ${w.message} [${w.type}]`);
      severity = "high";
      continue;
    }

    if (WARN.has(w.type)) {
      findings.push(`${side}: ${w.message} [${w.type}]`);
      severity = worstSeverity(severity, "caution");
      continue;
    }

    if (INFO.has(w.type)) {
      findings.push(`${side}: ${w.message} [${w.type}]`);
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

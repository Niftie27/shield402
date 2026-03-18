/**
 * Shield402 — Agent Pre-Trade Safety Check
 *
 * This example shows how a Solana trading agent would integrate
 * Shield402 as a pre-trade safety layer. Before submitting any
 * swap transaction, the agent:
 *
 * 1. Builds a trade intent with mint addresses
 * 2. Sends it to Shield402's /check-trade endpoint
 * 3. Reads the policy decision (allow / warn / block)
 * 4. Acts on the decision:
 *    - allow  → proceed with original parameters
 *    - warn   → apply recommended safer parameters, then proceed
 *    - block  → abort the trade entirely
 *
 * Fail-open vs fail-closed:
 *   This example uses FAIL_OPEN=false (fail-closed) by default,
 *   meaning trades are blocked if Shield402 is unreachable.
 *   Set FAIL_OPEN=true to proceed with original params on API failure.
 *   Choose based on your risk tolerance — fail-closed is safer,
 *   fail-open avoids blocking trades during outages.
 *
 * Usage:
 *   SHIELD402_URL=http://localhost:3402 npx tsx examples/agent-pretrade-check.ts
 *   FAIL_OPEN=true npx tsx examples/agent-pretrade-check.ts
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SHIELD402_URL = process.env.SHIELD402_URL ?? "http://localhost:3402";
const FAIL_OPEN = process.env.FAIL_OPEN === "true";

// Well-known Solana mints
const MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
} as const;

// ---------------------------------------------------------------------------
// Types (what Shield402 returns)
// ---------------------------------------------------------------------------

interface Shield402Response {
  request_id: string;
  decision: "allow" | "warn" | "block";
  policy: {
    recommended_slippage_bps?: number;
    recommended_send_mode?: "protected";
    recommended_priority_fee_lamports?: number;
  };
  policy_version: string;
  risk_level: "low" | "caution" | "high";
  reason: string;
  recommendation: string;
  confidence: "low" | "medium" | "high";
  live_sources: string[];
  triggered_rules: string[];
  rule_details: Array<{
    rule_id: string;
    triggered: boolean;
    severity: string;
    message: string;
  }>;
}

interface TradeIntent {
  input_mint: string;
  output_mint: string;
  amount_in: number;
  slippage_bps: number;
  send_mode: "standard" | "protected" | "unknown";
  priority_fee_lamports?: number;
}

// ---------------------------------------------------------------------------
// Shield402 client
// ---------------------------------------------------------------------------

async function checkTrade(trade: TradeIntent): Promise<Shield402Response | null> {
  try {
    const response = await fetch(`${SHIELD402_URL}/check-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chain: "solana", ...trade }),
    });

    if (!response.ok) {
      const error = await response.json() as Record<string, unknown>;
      throw new Error(`Shield402 rejected request: ${JSON.stringify(error)}`);
    }

    return response.json() as Promise<Shield402Response>;
  } catch (err) {
    if (FAIL_OPEN) {
      console.warn(`⚠ Shield402 unavailable (${(err as Error).message}). FAIL_OPEN=true → proceeding without safety check.`);
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Agent logic
// ---------------------------------------------------------------------------

async function executeTradeWithSafetyCheck(intent: TradeIntent): Promise<void> {
  console.log("=== Agent Pre-Trade Safety Check ===\n");
  console.log("Trade intent:");
  console.log(`  ${intent.input_mint.slice(0, 8)}… → ${intent.output_mint.slice(0, 8)}…`);
  console.log(`  Amount: ${intent.amount_in}`);
  console.log(`  Slippage: ${intent.slippage_bps} bps`);
  console.log(`  Send mode: ${intent.send_mode}`);
  if (intent.priority_fee_lamports) {
    console.log(`  Priority fee: ${intent.priority_fee_lamports} lamports`);
  }
  console.log();

  // Step 1: Ask Shield402
  console.log(`Checking with Shield402 at ${SHIELD402_URL}...`);
  const result = await checkTrade(intent);

  // Fail-open: Shield402 was unreachable but FAIL_OPEN=true
  if (!result) {
    console.log("\n→ PROCEEDING without safety check (fail-open).");
    submitTransaction(intent);
    return;
  }

  console.log(`\nDecision: ${result.decision.toUpperCase()}`);
  console.log(`Risk level: ${result.risk_level}`);
  console.log(`Confidence: ${result.confidence} (${result.live_sources.length > 0 ? result.live_sources.join(", ") : "static only"})`);
  console.log(`Reason: ${result.reason}`);

  if (result.triggered_rules.length > 0) {
    console.log(`Triggered: ${result.triggered_rules.join(", ")}`);
  }

  // Step 2: Act on the decision
  switch (result.decision) {
    case "allow": {
      console.log("\n→ PROCEEDING with original parameters.");
      submitTransaction(intent);
      break;
    }

    case "warn": {
      console.log(`\n→ WARNING: ${result.recommendation}`);
      console.log("  Applying recommended safer parameters...");

      const saferTrade: TradeIntent = {
        ...intent,
        slippage_bps: result.policy.recommended_slippage_bps ?? intent.slippage_bps,
        send_mode: result.policy.recommended_send_mode ?? intent.send_mode,
        priority_fee_lamports: result.policy.recommended_priority_fee_lamports ?? intent.priority_fee_lamports,
      };

      console.log(`  Slippage: ${intent.slippage_bps} → ${saferTrade.slippage_bps} bps`);
      console.log(`  Send mode: ${intent.send_mode} → ${saferTrade.send_mode}`);
      if (saferTrade.priority_fee_lamports !== intent.priority_fee_lamports) {
        console.log(`  Priority fee: ${intent.priority_fee_lamports ?? "none"} → ${saferTrade.priority_fee_lamports} lamports`);
      }

      submitTransaction(saferTrade);
      break;
    }

    case "block": {
      console.log(`\n→ BLOCKED: ${result.recommendation}`);
      console.log("  Trade aborted. Not submitting transaction.");
      break;
    }
  }
}

/**
 * Placeholder for actual transaction submission.
 * In a real agent, this would build and send a Solana transaction
 * via Jupiter, Raydium, or another DEX aggregator.
 */
function submitTransaction(trade: TradeIntent): void {
  console.log("\n  [Agent would submit transaction here]");
  console.log(`  Final params: ${trade.amount_in} @ ${trade.slippage_bps}bps, ${trade.send_mode}`);
}

// ---------------------------------------------------------------------------
// Example scenarios
// ---------------------------------------------------------------------------

async function main() {
  // Scenario 1: Safe trade — should get "allow"
  console.log("━".repeat(60));
  console.log("SCENARIO 1: Small safe trade\n");
  await executeTradeWithSafetyCheck({
    input_mint: MINTS.SOL,
    output_mint: MINTS.USDC,
    amount_in: 2,
    slippage_bps: 50,
    send_mode: "protected",
    priority_fee_lamports: 5000,
  });

  // Scenario 2: Risky trade — should get "warn" with safer params
  console.log("\n" + "━".repeat(60));
  console.log("SCENARIO 2: Trade with loose slippage\n");
  await executeTradeWithSafetyCheck({
    input_mint: MINTS.SOL,
    output_mint: MINTS.USDC,
    amount_in: 2,
    slippage_bps: 150,
    send_mode: "protected",
    priority_fee_lamports: 5000,
  });

  // Scenario 3: Dangerous trade — should get "block"
  console.log("\n" + "━".repeat(60));
  console.log("SCENARIO 3: Large dangerous trade\n");
  await executeTradeWithSafetyCheck({
    input_mint: MINTS.SOL,
    output_mint: MINTS.USDC,
    amount_in: 60,
    slippage_bps: 500,
    send_mode: "standard",
  });
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

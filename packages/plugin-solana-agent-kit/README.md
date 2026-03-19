# @shield402/plugin-solana-agent-kit

Pre-trade safety check plugin for [solana-agent-kit](https://github.com/sendaifun/solana-agent-kit). AI agents using solana-agent-kit automatically get Shield402 pre-trade safety checks before executing swaps.

## Status

This plugin is **not yet published to npm**. The source is TypeScript (`src/index.ts`) with no build step — it works when consumed via bundlers that handle `.ts` files (tsx, tsup, etc.) but is not yet packaged for `require()`/`import()`. A proper build step and `types` field will be added before publishing.

## Local usage

From a project in the same workspace or monorepo:

```typescript
import { Shield402Plugin } from "../path/to/packages/plugin-solana-agent-kit/src";

const agent = new SolanaAgentKit(wallet, rpcUrl, config)
  .use(Shield402Plugin);
```

The agent now has a `check_trade_safety` action. When a user asks about trading, the LLM can call it to check the trade before executing.

## Configuration

Set `SHIELD402_URL` to point to your Shield402 instance:

```bash
SHIELD402_URL=http://localhost:3402  # default
```

## What the LLM sees

The plugin registers one action:

**`check_trade_safety`** — Check if a proposed Solana trade is safe before executing. Returns allow/warn/block decision with recommended safer parameters.

Parameters:
- `input_mint` — Solana mint address of the token being sold
- `output_mint` — Solana mint address of the token being bought
- `amount_in` — Amount in human-readable units
- `slippage_bps` — Slippage tolerance in basis points
- `send_mode` — "standard", "protected", or "unknown"
- `priority_fee_lamports` — Priority fee (optional)

## Example response

Subset of fields — the plugin formats the full Shield402 response for LLM readability:

```json
{
  "decision": "warn",
  "risk_level": "caution",
  "reason": "Slippage of 200 bps is above recommended threshold.",
  "recommendation": "Reduce slippage to 75 bps or lower.",
  "confidence": "high",
  "recommended_slippage_bps": 75,
  "live_sources": ["jupiter", "jupiter-shield", "jupiter-tokens", "rugcheck"]
}
```

## How it works

The plugin calls Shield402's HTTP API (`POST /check-trade`) with the proposed trade parameters. Shield402 runs it through 8 rules (5 static + 3 live data) and returns a policy decision.

The agent can then:
- **allow** → proceed with the swap
- **warn** → apply recommended safer parameters
- **block** → refuse the trade and explain why

## Requirements

- Shield402 running (locally or deployed)
- `solana-agent-kit` v2+
- `zod` v3+


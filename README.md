# Shield402

A pre-trade safety API for Solana. Checks proposed trade configurations before send and returns a risk assessment with actionable recommendations.

Available as an HTTP API (with optional x402 micropayment gating) and a Telegram bot.

## What this does

You send a proposed Solana trade configuration with **mint addresses** (not ticker symbols). Shield402 runs it through a rule engine that combines static checks with live market data from Jupiter and token risk data from Rugcheck, and returns:

- a **policy decision** (allow / warn / block)
- **safer parameters** (recommended slippage, send mode, priority fee)
- a **risk level** (low / caution / high)
- a **reason** explaining the risk
- a **recommendation** for what to change
- which **rules triggered** and why
- which **live data sources** contributed (jupiter, rugcheck)
- a **confidence level** (medium = static rules only, high = static + live data)
- a **policy version** for tracking rule changes

## What this does NOT do

- Does not execute, route, or send trades
- Does not guarantee protection from MEV or sandwich attacks
- Does not replace Jito, Jupiter, or any execution infrastructure
- Does not verify on-chain state of the caller's transaction

Shield402 is an advisory layer. It catches risky configurations and suggests safer settings. It does not enforce them.

## Quick start

```bash
npm install
cp .env.example .env    # then edit .env with your values
npm run dev
```

## API usage

```bash
curl -X POST http://localhost:3402/check-trade \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "solana",
    "input_mint": "So11111111111111111111111111111111111111112",
    "output_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount_in": 25,
    "slippage_bps": 200,
    "send_mode": "standard"
  }'
```

Example response:

```json
{
  "request_id": "req_abc123_0001",
  "decision": "block",
  "policy": {
    "recommended_slippage_bps": 50,
    "recommended_send_mode": "protected",
    "recommended_priority_fee_lamports": 10000
  },
  "policy_version": "0.4.0",
  "risk_level": "high",
  "reason": "Dangerous combination: large trade (25 SOL), wide slippage (200 bps), and standard send mode. (5 risk factors detected)",
  "recommendation": "Tighten slippage, switch to protected send mode, and consider splitting the trade.",
  "confidence": "medium",
  "live_sources": [],
  "triggered_rules": [
    "slippage_too_wide",
    "unprotected_send_mode",
    "large_trade_loose_settings",
    "missing_execution_params",
    "unsafe_combination"
  ],
  "rule_details": [...]
}
```

Optional display fields: `input_symbol`, `output_symbol`, `route_hint`, `notes`.

## Telegram bot

Set `TELEGRAM_BOT_TOKEN` in `.env` and the bot starts alongside the API server. Send trade configs as JSON messages with symbol pairs (e.g. `"pair": "SOL/USDC"`) and the bot resolves them to mint addresses before running the rule engine.

The bot calls the rule engine directly (bypasses x402 payment gating).

## Rules

**Static rules** (always active):

1. **Slippage too wide** — flags slippage above configurable thresholds
2. **Unprotected send mode** — flags standard or unknown send modes
3. **Large trade + loose settings** — flags big trades with wide slippage or low priority fees
4. **Missing execution params** — flags omitted priority fee
5. **Unsafe combination** — escalates when multiple risk factors combine

**Live data rules** (active when providers are configured):

6. **High price impact** — queries Jupiter for real-time price impact on the proposed swap
7. **Token risk** — queries Rugcheck for token safety on both input and output tokens (freeze authority, ownership concentration, rug indicators)

Thresholds are in `src/config/riskConfig.ts`.

## Live market data

When `JUPITER_API_KEY` is set, Shield402 fetches a real-time quote from Jupiter before evaluating rules. This enables the price impact check. Jupiter receives mint addresses directly — no symbol resolution needed.

When `RUGCHECK_API_KEY` is set, Shield402 fetches token risk reports from Rugcheck for **both** the input and output tokens. This catches buy-side risk (acquiring a scam token) and sell-side risk (holding a token with freeze authority). The worst score between the two determines the assessment.

Either live data source upgrades confidence from "medium" to "high". The `live_sources` field in the response shows exactly which providers contributed. Jupiter and Rugcheck are fetched in parallel. If any is unavailable or times out (3s), the API falls back gracefully. It never blocks or fails because of a provider outage.

## Agent integration

See [`examples/agent-pretrade-check.ts`](examples/agent-pretrade-check.ts) for a working example of how a Solana trading agent would integrate Shield402 as a pre-trade safety layer.

```bash
# Start the server, then run the example:
npm run dev &
npx tsx examples/agent-pretrade-check.ts
```

The example demonstrates all three decision paths (allow → proceed, warn → apply safer params, block → abort) and includes a configurable fail-open/fail-closed strategy via `FAIL_OPEN=true`.

## MCP server

Shield402 is available as an [MCP](https://modelcontextprotocol.io/) tool server. AI agents (Claude Desktop, agent frameworks, etc.) can discover and call the `check-trade` tool automatically over stdio.

```bash
npm run mcp
```

To add Shield402 to an MCP client, point it at:

```json
{
  "mcpServers": {
    "shield402": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "env": {
        "JUPITER_API_KEY": "your-key",
        "RUGCHECK_API_KEY": "your-key"
      }
    }
  }
}
```

The MCP server calls the rule engine directly (in-process, no HTTP). It uses the same mint-based contract and returns the same policy response as the HTTP API.

## x402 payment gating

Shield402 supports optional x402 micropayment gating on `POST /check-trade`. When enabled, unpaid requests receive `402 Payment Required` with payment instructions. Paid requests get the full risk assessment.

Disabled by default. Set `X402_ENABLED=true` in `.env` to enable. See `.env.example` for all required variables.

`GET /health` is always free regardless of x402 setting.

### Known x402 limitation

The Express middleware settles payment after the route handler completes regardless of HTTP status code. Invalid requests returning 400 may still be settled. Acceptable for devnet; production deployment should add lifecycle hooks to skip settlement on client errors.

## Configuration

All configuration is via environment variables. See `.env.example` for the full list:

- `PORT` — server port (default 3402)
- `X402_ENABLED` — enable/disable payment gating
- `SVM_ADDRESS` — Solana wallet for receiving payments
- `FACILITATOR_URL` — x402 facilitator endpoint
- `X402_NETWORK` — Solana network in CAIP-2 format
- `X402_PRICE` — price per call in USD
- `TELEGRAM_BOT_TOKEN` — Telegram bot token (optional)
- `JUPITER_API_KEY` — Jupiter API key for live price impact (optional)
- `RUGCHECK_API_KEY` — Rugcheck API key for token risk scanning (optional)
- `SOLANA_RPC_URL` — reserved for future live chain queries (optional)

## Testing

```bash
npm test
```

Tests cover rule engine, schema validation, policy decisions, token risk (both input and output), live source provenance, and HTTP integration. Tests run with x402 disabled and without live data providers.

## Current status

- [x] Mint-based API contract (no ambiguous symbol resolution in the engine)
- [x] Rule engine with 5 static rules + 2 live data rules
- [x] Both-token Rugcheck scanning (input + output)
- [x] Live source provenance in responses and logs
- [x] Zod schema validation with base58 mint validation
- [x] Structured JSON request logging (decision, policy_version, live_sources)
- [x] HTTP error boundary (structured 500 responses)
- [x] x402 payment wrapping (Solana devnet)
- [x] Telegram bot with symbol-to-mint resolution
- [x] Jupiter live price impact integration
- [x] Rugcheck token risk integration
- [x] Policy layer (allow / warn / block + recommended safer parameters)
- [x] Agent integration example (HTTP API, fail-open/fail-closed)
- [x] MCP server for AI agent discovery
- [ ] Buyer validation — does anyone want this enough to integrate?
- [ ] Additional live signals (liquidity, volume)

## Known limitations

- Solana only
- Trusts caller-supplied `send_mode` — does not verify on-chain protection
- Size risk rule only calibrated for SOL-denominated trades (compares against SOL mint)
- Thresholds are static estimates, not dynamically adjusted
- No persistent storage — logs go to stdout only
- Not production-hardened (no rate limiting, auth, or deployment config)

## License

MIT

# Shield402

A pre-trade safety API for Solana. Checks proposed trade configurations before send and returns a risk assessment with actionable recommendations.

Available as an HTTP API (with optional x402 micropayment gating) and a Telegram bot.

## What this does

You send a proposed Solana trade configuration. Shield402 runs it through a rule engine that combines static checks with live market data from Jupiter, and returns:

- a **risk level** (low / caution / high)
- a **reason** explaining the risk
- a **recommendation** for what to change
- which **rules triggered** and why
- a **confidence level** (medium = static rules only, high = static + live data)

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
    "pair": "SOL/USDC",
    "amount_in": 25,
    "amount_in_symbol": "SOL",
    "slippage_bps": 200,
    "send_mode": "standard"
  }'
```

Example response:

```json
{
  "request_id": "req_abc123_0001",
  "risk_level": "high",
  "reason": "Dangerous combination: large trade (25 SOL), wide slippage (200 bps), and standard send mode. (5 risk factors detected)",
  "recommendation": "Tighten slippage, switch to protected send mode, and consider splitting the trade.",
  "confidence": "high",
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

## Telegram bot

Set `TELEGRAM_BOT_TOKEN` in `.env` and the bot starts alongside the API server. Send trade configs as JSON messages and get risk assessments back.

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

Thresholds are in `src/config/riskConfig.ts`.

## Live market data

When `JUPITER_API_KEY` is set, Shield402 fetches a real-time quote from Jupiter before evaluating rules. This enables the price impact check and upgrades confidence from "medium" to "high".

If Jupiter is unavailable or times out (3s), the API falls back to static rules only. It never blocks or fails because of a provider outage.

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
- `SOLANA_RPC_URL` — reserved for future live chain queries (optional)

## Testing

```bash
npm test
```

41 tests covering rule engine, schema validation, and HTTP integration. Tests run with x402 disabled and without live data providers.

## Current status

- [x] Rule engine with 5 static rules + 1 live data rule
- [x] Zod schema validation
- [x] Structured JSON request logging
- [x] HTTP integration tests
- [x] x402 payment wrapping (Solana devnet)
- [x] Telegram bot interface
- [x] Jupiter live price impact integration
- [ ] Buyer validation — does anyone want this enough to integrate?
- [ ] Policy layer reframing (allow / warn / block)
- [ ] MCP server for AI agent discovery
- [ ] Additional live signals (liquidity, volume)

## Known limitations

- Solana only
- Trusts caller-supplied `send_mode` — does not verify on-chain protection
- Size risk rule only calibrated for SOL-denominated trades
- Thresholds are static estimates, not dynamically adjusted
- No persistent storage — logs go to stdout only
- Not production-hardened (no rate limiting, auth, or deployment config)

## License

MIT

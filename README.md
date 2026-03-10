# Shield402 Lite

A pre-trade safety API for Solana.

Send a proposed trade configuration → get back a risk label, reason, and one safer recommendation.

## What this is

A simple API that checks a Solana trade setup before you send it and tells you if something looks risky. It runs deterministic rules against your trade config and returns advice.

## What this is NOT

- Not a guaranteed anti-MEV solution
- Not an execution engine
- Not a routing optimizer
- Not a wallet
- Not a trading bot
- Not a replacement for Jito, Jupiter, or any execution infrastructure

v1 uses static rule-based checks. It doesn't have live chain data. It catches obvious misconfigurations, not sophisticated attacks.

## Quick start

```bash
npm install
npm run dev
```

## Usage

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
  "risk_level": "caution",
  "reason": "Slippage of 200 bps is wider than recommended. (3 risk factors detected)",
  "recommendation": "Reduce slippage to 75 bps or lower.",
  "confidence": "medium",
  "triggered_rules": [
    "slippage_too_wide",
    "unprotected_send_mode",
    "large_trade_loose_settings"
  ],
  "rule_details": [...]
}
```

## v1 Rules

1. **Slippage too wide** — flags slippage above configurable thresholds
2. **Unprotected send mode** — flags standard or unknown send modes
3. **Large trade + loose settings** — flags big trades with wide slippage or low priority fees
4. **Missing execution params** — flags omitted priority fee
5. **Unsafe combination** — flags the worst case: large + wide slippage + unprotected

Thresholds are in `src/config/riskConfig.ts`.

## Roadmap

- [ ] x402 payment wrapping
- [ ] Tests and fixtures
- [ ] Telegram bot interface
- [ ] Live chain data integration
- [ ] MCP server exposure

## License

MIT

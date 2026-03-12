# Shield402 Lite

A pre-trade safety API for Solana, paid via [x402](https://x402.org).

Send a proposed trade configuration → get back a risk label, reason, and one safer recommendation.

## What this is

A simple API that checks a Solana trade setup before you send it and tells you if something looks risky. It runs deterministic rules against your trade config and returns advice. Callers pay per request using the x402 micropayment protocol.

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
cp .env.example .env    # then edit .env with your values
npm run dev
```

By default, x402 payment is **disabled** so you can test the API freely. To enable it, see [x402 Setup](#x402-setup) below.

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

When x402 is enabled, requests without payment receive `402 Payment Required` with a `PAYMENT-REQUIRED` header containing payment instructions.

## v1 Rules

1. **Slippage too wide** — flags slippage above configurable thresholds
2. **Unprotected send mode** — flags standard or unknown send modes
3. **Large trade + loose settings** — flags big trades with wide slippage or low priority fees
4. **Missing execution params** — flags omitted priority fee
5. **Unsafe combination** — flags the worst case: large + wide slippage + unprotected

Thresholds are in `src/config/riskConfig.ts`.

## x402 Setup

Shield402 uses x402 to charge a small fee per safety check. Payment is handled automatically by the x402 protocol — callers include a payment proof in their request header, and the facilitator settles it.

### 1. Get a Solana wallet

You need a Solana wallet address (base58) to receive payments. For devnet testing, any devnet wallet works.

### 2. Configure .env

```bash
X402_ENABLED=true
SVM_ADDRESS=<your-solana-base58-address>
FACILITATOR_URL=https://x402.org/facilitator
X402_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
X402_PRICE=$0.001
```

- `X402_ENABLED` — set to `true` to require payment, `false` for free access
- `SVM_ADDRESS` — your Solana address that receives payments
- `FACILITATOR_URL` — payment facilitator (`https://x402.org/facilitator` for devnet)
- `X402_NETWORK` — Solana network in CAIP-2 format (devnet shown above)
- `X402_PRICE` — price per call in USD

### 3. Start the server

```bash
npm run dev
```

You should see confirmation that x402 is enabled in the startup logs.

### Known x402 limitation

In the current Express middleware implementation, settlement occurs after the route handler completes regardless of HTTP status code. This means invalid requests that return 400 may still be settled. This is a known behavior of the x402 Express middleware and is acceptable for devnet testing. A production deployment should add lifecycle hooks to skip settlement on client errors.

## Testing

```bash
npm test
```

Tests run with x402 disabled so they don't need a facilitator connection.

## Roadmap

- [x] Rule engine and schema validation
- [x] Structured request logging
- [x] Automated tests
- [x] x402 payment wrapping
- [ ] Telegram bot interface
- [ ] Live chain data integration
- [ ] MCP server exposure

## License

MIT

# Shield402

## What this is
Pre-trade safety API for Solana — validates proposed trade configurations before execution and returns policy decisions (allow/warn/block) with recommended safer parameters.

## Tech Stack
- **Language:** TypeScript 5.6 (strict mode), Node.js 22
- **Framework:** Express 4
- **Testing:** Vitest 2.1 + Supertest
- **Key deps:** Zod (validation), grammy (Telegram bot), @modelcontextprotocol/sdk (MCP), @solana/kit, @x402/* (payment gating)
- **Build:** `tsc` → `dist/`, Docker multi-stage

## Architecture
```
Request (HTTP / Telegram / MCP / Plugin)
  │
  ├─ Validate (Zod schema, base58 mints)
  │
  ├─ Fetch live context (parallel, 3s timeout each, fail-open)
  │   ├─ Jupiter Quote  → price impact
  │   ├─ Jupiter Shield → 16 warning types (honeypot, freeze, etc.)
  │   ├─ Jupiter Tokens V2 → liquidity, organic score, audit
  │   └─ Rugcheck → risk score (0-100)
  │
  ├─ Rule engine (8 rules: 5 static + 3 live)
  │   → Each rule returns: triggered, severity (low/caution/high), message
  │   → Aggregation: max severity → decision (allow/warn/block)
  │
  └─ Response: decision + policy recommendations + confidence + provenance
```

**Key design principles:**
- Fail-open: provider outage → skip rule, never block API
- Mint-based: always base58 addresses, never ambiguous symbols
- Stateless: pure functions, no side effects, easy to test

## File Structure
```
src/
├── app.ts                    # Express app, middleware wiring
├── server.ts                 # Entry point, bot startup
├── routes/checkTrade.ts      # POST /check-trade handler
├── rules/                    # 8 evaluation rules
│   ├── index.ts              # evaluateTrade() + aggregation
│   ├── rule.ts               # Rule interface
│   ├── slippageRule.ts       # >100bps caution, >300bps high
│   ├── sendModeRule.ts       # Unprotected send = caution
│   ├── sizeRiskRule.ts       # Large SOL + wide slippage
│   ├── missingFieldsRule.ts  # Missing priority fee
│   ├── unsafeCombinationRule.ts  # Large + wide + unprotected = high
│   ├── priceImpactRule.ts    # [LIVE] Jupiter quote impact
│   ├── tokenSafetyRule.ts    # [LIVE] Shield + Rugcheck + Tokens V2
│   └── liquidityDepthRule.ts # [LIVE] Liquidity floors + cross-check
├── data/                     # External data fetching + caching
│   ├── liveContext.ts        # Orchestrates all 4 sources (parallel)
│   ├── jupiter.ts            # Quote API
│   ├── jupiterShield.ts      # Shield API (warnings)
│   ├── jupiterTokens.ts      # Tokens V2 API (liquidity, audit)
│   ├── rugcheck.ts           # Risk scores
│   ├── solana.ts             # On-chain RPC (mint decimals)
│   ├── mints.ts              # Token maps, symbol resolution
│   └── tokenCategory.ts     # stable/major/meme/unknown classification
├── schema/checkTradeSchema.ts  # Zod request validation
├── types/                    # TradeCheckRequest, TradeCheckResult
├── config/                   # riskConfig (thresholds), x402Config
├── middleware/               # API key auth, rate limiting
├── logging/logger.ts         # Structured JSON request logging
├── bot/                      # Telegram bot (grammy)
├── mcp/server.ts             # MCP server for AI agents
└── public/index.html         # Web dashboard UI

packages/plugin-solana-agent-kit/  # solana-agent-kit plugin (not published)
test/                              # 10 test files, ~2100 lines
examples/                          # Agent integration example
```

## Current State
**Complete:**
- Rule engine (8 rules: slippage, send mode, size risk, missing fields, unsafe combo, price impact, token safety, liquidity depth)
- Jupiter Shield + Tokens V2 + Rugcheck integration (live data)
- On-chain decimal resolution for any SPL token
- Zod validation with base58 mint checks
- Structured JSON logging with request IDs
- API key auth + rate limiting (20/min unauth, 200/min auth)
- x402 payment gating (opt-in, disabled by default)
- Telegram bot with symbol-to-mint resolution
- MCP server for AI agent discovery
- solana-agent-kit plugin
- Web dashboard
- Docker deployment
- Stablecoin warning suppression (USDC/USDT mint/freeze is normal)

**Not implemented:**
- No CI/CD pipeline
- No linting config (eslint/prettier)
- Size risk rule only for SOL-denominated trades
- Thresholds are static, not dynamically adjusted
- Solana only (multichain is long-term goal)
- Plugin not published to npm

## What Exists
- **Tests:** Yes — Vitest, 10 test files in `test/`, ~2100 lines. Covers all 8 rules, schema validation, middleware, HTTP integration, MCP, plugin.
- **Docs:** README.md (comprehensive, ~250 lines). No separate TESTING.md.
- **CI:** No GitHub Actions configured.
- **Linting:** No eslint/prettier config.
- **`.env` management:** `.env.example` with all variables documented. `.env` in `.gitignore`.

## Scripts
```bash
npm run dev          # Start dev server (tsx)
npm run build        # TypeScript compile + copy public/
npm start            # Run compiled dist/server.js
npm test             # Type-check + vitest run
npm run test:watch   # Vitest watch mode
npm run mcp          # Start MCP server (stdio)
```

## Rules
- Vysvětli co plánuješ udělat PŘED kódováním
- Piš unit testy ke každé funkci
- Nerozšiřuj scope bez mého souhlasu
- Po každé editaci řekni co se změnilo a proč

## Last Session
- **Date:** 2026-03-23
- **Builder:** Claude ext
- **What was done:** Created CLAUDE.md — full project audit and documentation
- **Where I stopped:** Project audit complete, no code changes made
- **Next step:** Set up CI (GitHub Actions), add linting, or continue feature work — your call
- **Open issues:** No CI pipeline, no linting config, plugin not published to npm, thresholds are static estimates

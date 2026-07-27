# MT5 — Active Buyer Meme Index

MT5 is a public research index for Solana meme coins. It observes the most
recent 30 minutes of primary-pool trades, estimates active buyers after
deduplication and basic automation filtering, ranks five coins by buy USD, and
weights their price movement by 35%-capped verified market capitalization with
divisor continuity.

Public site: <https://mt5-online-index.meme-top-5-index.workers.dev>

## Online data path

1. DEX Screener and GeckoTerminal discover and price eligible Solana tokens.
2. GeckoTerminal pool trades provide transaction hash, signing wallet, side,
   timestamp, and USD volume.
3. The server removes duplicate transactions, sub-1-USD dust-only wallets, and
   high-frequency burst wallets.
4. The API returns observed wallets, estimated active buyers, 30-minute buy
   USD, and whether the 300-trade response covers the full window.
5. A Cloudflare Cron Trigger refreshes the index every minute. A D1 lease
   rotates over the selected pools, requests at most five new transactions
   through keyless PublicNode with the official Solana endpoint as fallback
   (or Helius when configured), and stores normalized observations without a
   local process.
6. Jupiter and Helius provide independent price, supply, authority, and mint
   verification when production keys are configured.
7. D1 can also receive Helius or Birdeye observations through the authenticated
   `/api/ingest/trades` endpoint.
8. `/api/backing` verifies configured Squads v4 and Token-2022 authorities,
   values the public Vault, and reconciles it with two signed reserve reports.
9. Two external Ed25519 oracle attesters must sign the exact published index
   digest before the Mainnet gate can pass.

The estimate is wallet-derived and is not proof of a natural person. When a
30-minute window contains more than 300 trades, the public values are labeled
as lower bounds. Token NAV remains fail-closed until the stricter human-entity,
market-consensus, on-chain, custody, audit, and legal release gates pass.

## Development

```bash
npm install
npm test
npm run dev
```

The public API is available at `/api/index`. Its cache policy refreshes the
online computation every 60 seconds and serves the last successful snapshot
during short source interruptions. `/api/backing` verifies signed reserve
reports against the public on-chain Vault, while `/api/shadow-readiness`
publishes the immutable 30-day Mainnet rehearsal scorecard collected by the
Cloudflare scheduled worker.

Production preparation:

```bash
npm run token:devnet:verify
npm run token:mainnet:check
```

The Mainnet operating model and approval packets are under `docs/`. Release
approvals are recorded by hashing the actual counsel, custody, audit, shadow
operation, and officer artifacts with `npm run release:evidence -- ...`.
Editing a release boolean does not pass the gate.

## Optional collectors

The website and its request-driven Solana RPC fallback work online without a
local collector. Optional long-running Helius and
Birdeye collectors can add cross-pool observations to D1:

```bash
npm run collector
npm run collector:birdeye
```

Environment variable names and free-plan budgets are documented in
`.env.example`. Local secrets must never be committed.

## Research token

`MT5R` is a non-valued Solana devnet research token. It is not an index share,
redeemable asset, deposit product, or mainnet investment token.

Devnet mint:
[`ENSG3jHnZM3EgzMb8WZHMg4oQ1hZL8KisuTCx7f8msHt`](https://explorer.solana.com/address/ENSG3jHnZM3EgzMb8WZHMg4oQ1hZL8KisuTCx7f8msHt?cluster=devnet)

The intended Mainnet product does not reuse this immutable research mint. It
requires a new Token-2022 mint whose mint and freeze authorities are dedicated
Squads Vault PDAs and whose initial supply is zero until every release gate
passes.

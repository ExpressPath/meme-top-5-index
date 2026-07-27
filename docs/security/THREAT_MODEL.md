# MT5 Threat Model

## Protected assets

- constituent tokens and USDC held in the dedicated Squads Vault
- MT5 Share mint and freeze authorities
- index-signing and reserve-attestation keys
- investor and approved-participant records held by regulated partners
- D1 trade, index-state, nonce, and attestation records
- release-evidence artifacts and their hashes

## Trust boundaries

1. Public market and Solana RPC providers are untrusted inputs.
2. Cloudflare Worker and D1 form one operational trust domain.
3. Squads members are separate human authorization domains.
4. Custodian and reserve reporters are independent external domains.
5. Legal counsel and security reviewer are external evidence issuers.

## Primary threats and controls

### Oracle manipulation

Two market-source consensus, divergence thresholds, on-chain mint checks,
signed snapshots, external attestations, and fail-closed publication prevent a
single price feed from authorizing NAV.

### Mint or treasury key compromise

Mint, freeze, and Vault transactions require a 2-of-3 Squads decision.
Production signers use distinct hardware devices and recovery locations. There
is no single config authority.

### False proof of reserves

Two reporters must submit identical normalized holdings. The API separately
reads the public Squads Vault and rejects a report that differs by over 10 bps.
The reserve ratio must be at least 102%.

### Replay and forged ingestion

Trade ingestion uses HMAC-SHA256 over timestamp, nonce, and exact body.
Nonces persist for 24 hours, requests have a five-minute validity window, and
write routes are rate limited.

### Constituent exploit or liquidity collapse

The index halts NAV publication when source, liquidity, authority, or demand
coverage gates fail. Emergency removal requires an incident record and a
multisig transaction.

### Governance capture

Non-emergency membership, threshold, authority, and spending-limit changes
have a 24-hour timelock. Signers must verify the decoded transaction and
reference release evidence before approval.

### Denial of service

Public reads use D1 snapshots instead of refreshing upstream sources. Cron
refresh is secret-authenticated. Upstream failures degrade or halt the index
without allowing stale data to authorize issuance.

## Explicit exclusions

This model does not claim to mitigate loss caused by fraudulent legal,
custody, or audit documents. Those documents require direct counterparty
verification before their hashes are recorded.

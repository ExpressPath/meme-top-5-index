# Independent Security Review Scope

## In scope

- methodology 4.0 weighting and divisor continuity
- market-source consensus and publication state transitions
- Solana mint and authority verification
- D1 snapshot, trade, nonce, reserve-report, and oracle-attestation handling
- HMAC authentication and replay protection
- Ed25519 snapshot signatures
- Squads Vault address and Token-2022 authority verification
- reserve valuation, drift, and attestation-to-chain reconciliation
- Mainnet release-evidence validation
- Cloudflare Worker headers, secrets, rate limits, Cron, and D1 bindings
- dependency and CI security controls

## Required tests

- unauthorized refresh and ingestion attempts
- stale timestamps, duplicate nonces, malformed Solana addresses, oversized
  payloads, and signer substitution
- market-source disagreement and RPC outage
- stale, conflicting, and forged reserve reports
- Vault with missing, excess, or unexpected assets
- incorrect mint/freeze authority and fake Squads account
- divisor continuity across daily and emergency rebalance
- evidence hash mismatch and missing approval artifact
- dependency compromise and build reproducibility

## Deliverables

- severity-ranked findings with reproduction steps
- explicit statement of reviewed commit SHA
- dependency and third-party-program assumptions
- confirmation of retest for every high and critical finding
- signed final report suitable for hashing into
  `token/release-evidence.json`

The reviewer must state that source verification is not equivalent to a
security guarantee and identify all unreviewed operational or legal controls.

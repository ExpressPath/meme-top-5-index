# MT5 Mainnet Release Runbook

## Release model

MT5 Index Vault Share is a permissioned primary-market receipt for a
segregated Solana basket. It is not launched through a public presale.
Creation and redemption are executed only after KYC/AML approval, reserve
verification, and a 2-of-3 Squads approval.

The production design intentionally uses the audited Solana Token-2022 and
Squads v4 programs. No project-authored on-chain program is deployed.

## Required public addresses

The following must be configured in the production Worker and published:

- Squads multisig address
- Squads Vault 0 PDA used only for MT5 reserves
- Token-2022 MT5 Share mint
- mint-authority Vault PDA
- freeze-authority incident Vault PDA
- mainnet USDC mint

The multisig configuration is 2-of-3, has no unilateral config authority,
uses two hardware-backed signers, and applies a 24-hour timelock to
non-emergency governance changes.

## Creation

1. An approved participant submits a creation request and completes KYC/AML.
2. Operations calculates the exact five-asset basket and 2% USDC buffer from
   the signed MT5 snapshot.
3. Assets settle into the dedicated Squads Vault.
4. Two independent reserve reporters attest to the same normalized report.
5. `/api/backing` must show:
   - `releaseEligible: true`
   - two attestations
   - on-chain Vault verification passed
   - reserve ratio at least 102%
   - maximum basket drift at most 100 bps
   - attestation-to-chain difference at most 10 bps
6. Operations proposes the exact Token-2022 mint transaction in Squads.
7. A second signer independently verifies the destination, amount, snapshot
   digest, and reserve report before approving.
8. The transaction ID and approval packet are retained.

## Redemption

1. The approved participant returns MT5 Shares to the controlled redemption
   account.
2. Operations verifies finality and proposes a burn.
3. After the burn reaches finality, the corresponding basket is released from
   the Vault by a separate Squads proposal.
4. Redemption assets never leave the Vault before the burn is finalized.

## Rebalance

Daily at 00:00 UTC, operations compares actual Vault weights with the signed
index snapshot. Rebalance is required when any constituent exceeds 100 bps of
drift. Every trade is proposed through Squads and requires two approvals.

## Emergency stop

No creation or redemption is permitted when any index, reserve, authority,
market-data, chain, legal, custody, or audit gate is not verified. Incident
handling follows `docs/security/INCIDENT_RESPONSE.md`.

## Final command gate

`npm run token:mainnet:check` must exit successfully immediately before any
Mainnet creation, redemption, authority, or public-deposit transaction.

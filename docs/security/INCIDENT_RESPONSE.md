# MT5 Incident Response

## Severity

- SEV-0: suspected key compromise, unauthorized mint, reserve loss, or active
  exploit.
- SEV-1: incorrect NAV, reserve shortfall, signer outage, or constituent
  exploit without confirmed loss.
- SEV-2: data-source degradation, delayed reporting, or non-critical service
  outage.

## Immediate actions

For SEV-0 and SEV-1:

1. Stop creation, redemption, deposits, and rebalances.
2. Preserve logs, transaction IDs, response bodies, and signer-device state.
3. Publish a neutral incident notice without speculative claims.
4. Verify Squads member list, threshold, timelock, Vault balances, mint
   authority, freeze authority, and recent transactions from independent RPCs.
5. If an unauthorized transfer is pending, use the approved emergency Squads
   path. Never rotate authority to an individual wallet.
6. Notify counsel, custody counterparty, distribution partner, and independent
   security reviewer.

## Recovery

Recovery requires:

- root cause and affected interval identified
- Vault and supply independently reconciled
- compromised keys removed through an approved multisig proposal
- legal and custody approval for reopening
- corrected software tested on Devnet
- incident report hash recorded as release evidence
- two-person approval to resume

## Communications

Public updates state confirmed facts, affected functions, protective actions,
and the next scheduled update. They never promise reimbursement or legal
classification without counsel approval.

## Evidence retention

Retain Cloudflare logs, D1 export, Git commit, dependency lockfile, transaction
messages, hardware-wallet confirmations, reserve reports, and all external
notices for the period required by counsel and the regulated partner.

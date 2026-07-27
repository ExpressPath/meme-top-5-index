# Squads 2-of-3 Setup Ceremony

## Member layout

- Member A: operations hardware wallet
- Member B: independent security/custody hardware wallet
- Member C: geographically separate recovery hardware wallet

No seed phrase, device, PIN, recovery copy, or cloud account may be shared
between members. At least two members use hardware wallets.

## Configuration

- Squads Protocol v4
- threshold: 2
- members: 3
- config authority: none
- Vault 0: dedicated basket and USDC reserves
- Vault 1: mint authority
- Vault 2: emergency freeze authority
- non-emergency configuration timelock: 86,400 seconds
- no standing unrestricted spending limit

## Ceremony record

Record:

- date and participants
- wallet public keys verified on each device
- Squads multisig and Vault addresses
- threshold, permissions, timelock, and config authority
- funding transaction
- test proposal, independent decoding, approvals, and execution
- Token-2022 mint/freeze authority transfer transactions
- screenshots or exported transaction messages
- independent reviewer conclusion

Private seed material must never enter the record. Hash the final ceremony
record and attach it to the security-review evidence.

## User approval actions

The user must personally:

1. connect the creator hardware wallet to Squads;
2. verify the two other member addresses out of band;
3. approve the deployment fee and inspect the resulting multisig address;
4. have a second member approve and execute a harmless test transaction;
5. approve each Token-2022 authority transfer only after the displayed mint
   and Vault PDA match the release packet.

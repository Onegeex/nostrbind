# NostrBind

**Pay any Nostr user in Bitcoin Cash, and know it's really them.**

NostrBind links a Nostr identity to a BCH address with cryptographic proof on both sides, then lets anyone look that identity up and pay it in BCH. No accounts, no custodians, no central database: every check runs in the browser.

Built for [BCH BLAZE 2026](https://dorahacks.io/hackathon/bchblaze2026/detail).

## How it works

A binding is two public proofs that point at each other:

1. **BCH → Nostr (on-chain).** The user's wallet signs a mainnet transaction that spends coins *from the identity address* and adds an OP_RETURN output:

   ```
   OP_RETURN  "NBND"  <version 1>  <32-byte Nostr public key>
   ```

   Change goes back to the same address. Only the holder of that address's key can produce this transaction.

2. **Nostr → BCH (on relays).** The user's Nostr key then signs a replaceable event (kind `30078`, `d` tag `nostrbind`) with an `i` tag naming the BCH address and the commitment txid:

   ```json
   ["i", "bch:bitcoincash:q...", "<commitment txid>"]
   ```

**Verification** (in `src/lib/verify.ts`), given an npub, NIP-05 name or BCH address:

- the Nostr event exists on relays and its signature is valid
- the referenced transaction exists on BCH and carries the NostrBind OP_RETURN
- the OP_RETURN names this exact Nostr key
- the transaction was signed by the BCH address the event claims (input pubkey → hash160 → address)
- the address has not since committed to a different key (newest commitment wins)

All five must pass for the green **Verified** badge.

**Key rotation:** bind again. The new event replaces the old one (replaceable kind), and a newer commitment from the address supersedes the older one.

## Free verified names

Every passport can claim a free name like `abiola@nostrbind.vercel.app`, a standard Nostr address (NIP-05) that clients such as Damus and Primal display.

- The name rides in the binding event as an `["n", "abiola"]` tag, so there is no database.
- `/.well-known/nostr.json?name=abiola` (a Vercel function in `server/nip05.ts`) finds every binding that claims the name, fully re-verifies each one, and answers only for a verified passport.
- If several verified passports claim the same name, the one whose Bitcoin Cash commitment **confirmed first** owns it. Block height can't be back-dated, unlike a Nostr event's timestamp.
- After binding, one click adds the name to your Nostr profile (every other profile field is kept).

## Features

- **Look up & pay:** search by npub, NIP-05 (`name@domain`) or BCH address, see each check, and pay a verified identity in BCH through WizardConnect.
- **Bind my identity:** use a Nostr browser extension (Alby, nos2x) or create a key in the page, connect a BCH wallet with WizardConnect, choose the identity address, and bind in two approvals.
- Never spends CashToken UTXOs by accident; tokens are left untouched.

## Tech stack

| Piece | Library |
| --- | --- |
| App | Vite, React, TypeScript |
| Wallet connection | `@wizardconnect/react`, `@wizardconnect/dapp` |
| Transactions | `@bitauth/libauth` |
| Chain reads + broadcast | `@electrum-cash/network` (public Fulcrum servers over WSS) |
| Nostr | `nostr-tools` (NIP-01, NIP-05, NIP-07, NIP-19, NIP-78) |

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run build:api  # bundle server/nip05.ts into api/nip05.mjs (commit the result)
npx tsx tests/logic.test.ts   # proof + name-ownership tests (offline)
```

You need a WizardConnect-capable BCH wallet (for example Cashonize 0.9+) with a little BCH (0.0001 BCH is plenty) to bind.

## Project layout

```
src/lib/bch.ts      OP_RETURN encode/decode, tx building, signer extraction (pure, tested)
src/lib/chain.ts    Fulcrum client: UTXOs, history, raw tx, broadcast
src/lib/nostr.ts    keys, binding event, relays, NIP-05
src/lib/verify.ts   both-way verification
src/lib/wallet.ts   WizardConnect: derive addresses, scan coins, sign + broadcast
src/App.tsx         UI
```

## Settings

`src/lib/config.ts` holds relays, Fulcrum servers and `DEMO_LOOKUP` (set it to your own npub after binding, so visitors get a one-click demo).

## License

MIT

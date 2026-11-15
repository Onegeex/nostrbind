// Network + protocol constants for NostrBind.

export const APP_NAME = "NostrBind";

// Public Fulcrum (Electrum Cash) servers reachable over secure WebSocket (port 50004).
export const FULCRUM_HOSTS = [
  "bch.imaginary.cash",
  "electroncash.de",
  "bch.loping.net",
];

// Nostr relays the binding event is published to and read from.
export const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

// Nostr event that carries the BCH side of the binding.
// kind 30078 = parameterized replaceable "application data" (NIP-78),
// so a newer binding by the same key replaces the old one (key rotation).
export const BINDING_KIND = 30078;
export const BINDING_D_TAG = "nostrbind";

// OP_RETURN layout: OP_RETURN <"NBND"> <version byte> <32-byte Nostr x-only pubkey>
export const OP_RETURN_PREFIX = "NBND";
export const OP_RETURN_VERSION = 1;

// Fee rate in satoshis per byte. BCH relay minimum is 1 sat/byte.
export const FEE_RATE = 1;
export const DUST_LIMIT = 546n;

// How many HD addresses to scan on each path when looking for coins.
export const SCAN_RECEIVE = 20;
export const SCAN_CHANGE = 10;

export const EXPLORER_TX = (txid: string) =>
  `https://explorer.salemkode.com/tx/${txid}`;

// Shown on the Look up screen as "Try the demo profile". Set this to your own
// npub after you bind, so judges can verify + pay in one click.
export const DEMO_LOOKUP = "";

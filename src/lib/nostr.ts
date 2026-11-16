// Nostr side: keys, the binding event, relay I/O and NIP-05 lookup.
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  verifyEvent,
  type Event,
  type EventTemplate,
} from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import { queryProfile } from "nostr-tools/nip05";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { BINDING_D_TAG, BINDING_KIND, RELAYS } from "./config";

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(e: EventTemplate): Promise<Event>;
    };
  }
}

export interface NostrSigner {
  pubkey: string; // hex
  kind: "extension" | "local";
  sign(t: EventTemplate): Promise<Event>;
}

const LOCAL_KEY = "nostrbind-local-nsec";

export function hasExtension(): boolean {
  return typeof window !== "undefined" && !!window.nostr;
}

export async function extensionSigner(): Promise<NostrSigner> {
  if (!window.nostr) throw new Error("No Nostr extension found. Install Alby or nos2x, or use a local key.");
  const pubkey = await window.nostr.getPublicKey();
  return { pubkey, kind: "extension", sign: (t) => window.nostr!.signEvent(t) };
}

/** A key generated and kept in this browser. Fine for a demo; users can export it. */
export function localSigner(): NostrSigner {
  let sk: Uint8Array;
  const stored = localStorage.getItem(LOCAL_KEY);
  if (stored) {
    sk = hexToBytes(stored);
  } else {
    sk = generateSecretKey();
    localStorage.setItem(LOCAL_KEY, bytesToHex(sk));
  }
  return {
    pubkey: getPublicKey(sk),
    kind: "local",
    sign: async (t) => finalizeEvent(t, sk),
  };
}

export function localNsec(): string | null {
  const stored = localStorage.getItem(LOCAL_KEY);
  return stored ? nip19.nsecEncode(hexToBytes(stored)) : null;
}

export function forgetLocalKey() {
  localStorage.removeItem(LOCAL_KEY);
}

export const npubOf = (hex: string) => nip19.npubEncode(hex);

export function shortNpub(hex: string): string {
  const n = npubOf(hex);
  return `${n.slice(0, 12)}…${n.slice(-6)}`;
}

const pool = new SimplePool();

/** The event a user signs: "my BCH identity is <address>, committed in <txid>". */
export function bindingTemplate(address: string, txid: string): EventTemplate {
  return {
    kind: BINDING_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", BINDING_D_TAG],
      // NIP-39 style external identity claim: platform "bch", identity, proof (the commitment txid)
      ["i", `bch:${address}`, txid],
      ["alt", "NostrBind: binds this Nostr key to a Bitcoin Cash address"],
    ],
    content: JSON.stringify({ v: 1, address, txid }),
  };
}

export async function publish(event: Event): Promise<number> {
  const results = await Promise.allSettled(pool.publish(RELAYS, event));
  const ok = results.filter((r) => r.status === "fulfilled").length;
  if (ok === 0) throw new Error("No relay accepted the binding event. Try again in a moment.");
  return ok;
}

export interface BindingClaim {
  event: Event;
  address: string;
  txid: string;
}

/** Latest valid binding event from this pubkey, or null. */
export async function fetchBinding(pubkey: string): Promise<BindingClaim | null> {
  const events = await pool.querySync(
    RELAYS,
    { kinds: [BINDING_KIND], authors: [pubkey], "#d": [BINDING_D_TAG] },
    { maxWait: 4000 },
  );
  const valid = events
    .filter((e) => e.pubkey === pubkey && verifyEvent(e))
    .sort((a, b) => b.created_at - a.created_at);
  for (const e of valid) {
    const c = claimFrom(e);
    if (c) return c;
  }
  return null;
}

function claimFrom(e: Event): BindingClaim | null {
  const tag = e.tags.find((t) => t[0] === "i" && t[1]?.startsWith("bch:"));
  return tag && tag[2] ? { event: e, address: tag[1].slice(4), txid: tag[2] } : null;
}

/** Most recent bindings across all users, newest first, one per pubkey. */
export async function fetchRecentBindings(limit = 24): Promise<BindingClaim[]> {
  const events = await pool.querySync(
    RELAYS,
    { kinds: [BINDING_KIND], "#d": [BINDING_D_TAG], limit: limit * 2 },
    { maxWait: 4000 },
  );
  const latest = new Map<string, Event>();
  for (const e of events) {
    if (!verifyEvent(e)) continue;
    const prev = latest.get(e.pubkey);
    if (!prev || e.created_at > prev.created_at) latest.set(e.pubkey, e);
  }
  return [...latest.values()]
    .sort((a, b) => b.created_at - a.created_at)
    .map(claimFrom)
    .filter((c): c is BindingClaim => c !== null)
    .slice(0, limit);
}

export async function fetchProfiles(pubkeys: string[]): Promise<Map<string, Profile>> {
  const out = new Map<string, Profile>();
  if (pubkeys.length === 0) return out;
  const events = await pool.querySync(RELAYS, { kinds: [0], authors: pubkeys }, { maxWait: 3500 });
  const newest = new Map<string, Event>();
  for (const e of events) {
    const p = newest.get(e.pubkey);
    if (!p || e.created_at > p.created_at) newest.set(e.pubkey, e);
  }
  for (const [pk, e] of newest) {
    try {
      out.set(pk, JSON.parse(e.content) as Profile);
    } catch {
      /* ignore malformed profile */
    }
  }
  return out;
}

/** A public note announcing a payment, tagging the recipient. */
export function paymentNoteTemplate(recipient: string, amountBch: string, link: string): EventTemplate {
  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", recipient],
      ["t", "bitcoincash"],
      ["t", "nostrbind"],
    ],
    content: `Just paid nostr:${npubOf(recipient)} ${amountBch} BCH, straight to their verified Bitcoin Cash address.\n\nCheck their NostrBind passport: ${link}`,
  };
}

export interface Profile {
  name?: string;
  display_name?: string;
  picture?: string;
  nip05?: string;
  about?: string;
}

export async function fetchProfile(pubkey: string): Promise<Profile | null> {
  const ev = await pool.get(RELAYS, { kinds: [0], authors: [pubkey] }, { maxWait: 3000 });
  if (!ev) return null;
  try {
    return JSON.parse(ev.content) as Profile;
  } catch {
    return null;
  }
}

/** Accepts npub, nprofile, 64-hex pubkey or a NIP-05 name. Returns hex pubkey. */
export async function resolvePubkey(input: string): Promise<string | null> {
  const s = input.trim().replace(/^nostr:/, "");
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  if (s.startsWith("npub1") || s.startsWith("nprofile1")) {
    try {
      const d = nip19.decode(s);
      if (d.type === "npub") return d.data;
      if (d.type === "nprofile") return d.data.pubkey;
    } catch {
      return null;
    }
  }
  if (s.includes("@") || s.includes(".")) {
    const p = await queryProfile(s.includes("@") ? s : `_@${s}`);
    return p?.pubkey ?? null;
  }
  return null;
}

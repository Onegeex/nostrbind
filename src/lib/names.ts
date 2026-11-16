// Free NostrBind names: "name@<host>", served as NIP-05 by /.well-known/nostr.json.
// A name is claimed by putting ["n", name] in the binding event. If several
// verified passports claim the same name, the one whose Bitcoin Cash
// commitment confirmed first (lowest block height) owns it.

export const NAME_RE = /^[a-z0-9][a-z0-9_.-]{1,29}$/;

export function normaliseName(input: string): string {
  return input.trim().toLowerCase();
}

export function nameError(name: string): string | null {
  if (!name) return null;
  if (name.length < 2) return "Names need at least 2 characters.";
  if (name.length > 30) return "Names can be at most 30 characters.";
  if (!NAME_RE.test(name)) return "Use lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number.";
  return null;
}

export interface Claimant {
  pubkey: string;
  height: number; // 0 or less = unconfirmed
  createdAt: number;
}

/** Earliest confirmed commitment wins; unconfirmed ones only win if nothing is confirmed. */
export function pickOwner(claims: Claimant[]): Claimant | null {
  if (claims.length === 0) return null;
  const rank = (c: Claimant) => (c.height > 0 ? c.height : Number.MAX_SAFE_INTEGER);
  return [...claims].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt || a.pubkey.localeCompare(b.pubkey))[0];
}

/** Ask the NIP-05 endpoint who owns a name. Returns the hex pubkey or null. */
export async function nameOwner(name: string, origin = location.origin): Promise<string | null> {
  const r = await fetch(`${origin}/.well-known/nostr.json?name=${encodeURIComponent(name)}`);
  if (!r.ok) return null;
  const j = (await r.json()) as { names?: Record<string, string> };
  return j.names?.[name] ?? null;
}

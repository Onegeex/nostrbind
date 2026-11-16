// Verification: re-checks both halves of a binding in the browser. No server is trusted.
import { addressToLockingBytecode, normaliseAddress, parseCommitmentTx } from "./bch";
import { getHistory, getRawTx } from "./chain";
import { fetchBinding, type BindingClaim } from "./nostr";

export interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface VerifyResult {
  verified: boolean;
  pubkey: string;
  address?: string;
  txid?: string;
  boundAt?: number;
  checks: Check[];
}

const HISTORY_SCAN = 30;

/** Latest NostrBind commitment signed by this address (newest first by block height). */
export async function latestCommitmentFrom(address: string) {
  const history = await getHistory(addressToLockingBytecode(address));
  // height 0 / -1 = unconfirmed (newest). Sort newest first.
  const ordered = [...history]
    .sort((a, b) => (a.height <= 0 ? Infinity : a.height) - (b.height <= 0 ? Infinity : b.height))
    .reverse()
    .slice(0, HISTORY_SCAN);
  // Fetch in parallel, then pick the newest match in order.
  const raws = await Promise.all(ordered.map((h) => getRawTx(h.tx_hash).catch(() => null)));
  for (let i = 0; i < ordered.length; i++) {
    const raw = raws.at(i);
    if (!raw) continue;
    const parsed = parseCommitmentTx(ordered[i].tx_hash, raw);
    if (parsed && parsed.signerAddresses.includes(address)) return parsed;
  }
  return null;
}

export async function verifyPubkey(pubkey: string, known?: BindingClaim | null): Promise<VerifyResult> {
  const checks: Check[] = [];
  const result: VerifyResult = { verified: false, pubkey, checks };

  const claim = known ?? (await fetchBinding(pubkey));
  checks.push({
    label: "Nostr key signed a binding to a BCH address",
    ok: !!claim,
    detail: claim ? undefined : "No NostrBind event from this key on the relays.",
  });
  if (!claim) return result;

  let address: string;
  try {
    address = normaliseAddress(claim.address);
  } catch {
    checks.push({ label: "Claimed BCH address is valid", ok: false, detail: claim.address });
    return result;
  }
  result.address = address;
  result.txid = claim.txid;
  result.boundAt = claim.event.created_at;

  let raw: string;
  try {
    raw = await getRawTx(claim.txid);
  } catch {
    checks.push({ label: "Commitment transaction exists on BCH", ok: false, detail: claim.txid });
    return result;
  }
  const parsed = parseCommitmentTx(claim.txid, raw);
  checks.push({
    label: "Commitment transaction exists on BCH",
    ok: !!parsed,
    detail: parsed ? undefined : "Transaction has no NostrBind OP_RETURN.",
  });
  if (!parsed) return result;

  const keyMatches = parsed.nostrPubkey === pubkey;
  checks.push({
    label: "Transaction commits to this Nostr key",
    ok: keyMatches,
    detail: keyMatches ? undefined : "It names a different Nostr key.",
  });

  const signedByAddress = parsed.signerAddresses.includes(address);
  checks.push({
    label: "Transaction was signed by the claimed BCH address",
    ok: signedByAddress,
    detail: signedByAddress ? undefined : "The address in the Nostr event did not sign it.",
  });

  // Has this address since been bound to a different key? Newest commitment wins.
  let stillCurrent = true;
  try {
    const latest = await latestCommitmentFrom(address);
    if (latest && latest.nostrPubkey !== pubkey) stillCurrent = false;
  } catch {
    /* history lookup is best-effort */
  }
  checks.push({
    label: "Address has not been re-bound to another key",
    ok: stillCurrent,
    detail: stillCurrent ? undefined : "A newer commitment from this address names a different key.",
  });

  result.verified = keyMatches && signedByAddress && stillCurrent;
  return result;
}

/** Look up by BCH address: find its newest commitment, then verify that key both ways. */
export async function verifyAddress(input: string): Promise<VerifyResult | null> {
  const address = normaliseAddress(input);
  const latest = await latestCommitmentFrom(address);
  if (!latest) return null;
  const r = await verifyPubkey(latest.nostrPubkey);
  if (r.address && r.address !== address) {
    r.verified = false;
    r.checks.push({
      label: "Nostr key's current binding points back to this address",
      ok: false,
      detail: `Key now points to ${r.address}`,
    });
  }
  return r;
}

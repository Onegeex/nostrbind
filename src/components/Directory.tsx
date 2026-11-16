import { useEffect, useState } from "react";
import { fetchProfiles, fetchRecentBindings, npubOf, type BindingClaim, type Profile } from "../lib/nostr";
import { verifyPubkey } from "../lib/verify";

type Status = "checking" | "verified" | "failed";

interface Row {
  claim: BindingClaim;
  profile?: Profile;
  status: Status;
}

async function inBatches<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export function Directory({ onInspect, onGetPassport }: { onInspect: (q: string) => void; onGetPassport: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const claims = await fetchRecentBindings(12);
        if (!alive) return;
        setRows(claims.map((claim) => ({ claim, status: "checking" })));
        const profiles = await fetchProfiles(claims.map((c) => c.event.pubkey));
        if (!alive) return;
        setRows((r) => r?.map((row) => ({ ...row, profile: profiles.get(row.claim.event.pubkey) })) ?? null);
        await inBatches(claims, 3, async (claim) => {
          let status: Status = "failed";
          try {
            status = (await verifyPubkey(claim.event.pubkey, claim)).verified ? "verified" : "failed";
          } catch {
            status = "failed";
          }
          if (alive) setRows((r) => r?.map((row) => (row.claim === claim ? { ...row, status } : row)) ?? null);
        });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const shown = rows?.filter((r) => r.status !== "failed") ?? null;

  return (
    <section className="ledger" aria-labelledby="ledger-title">
      <div className="ledger-head">
        <h2 id="ledger-title">Recently stamped</h2>
        <p>People who bound a Nostr key to a Bitcoin Cash address. Each row is checked live in your browser.</p>
      </div>

      {error && <p className="error">Couldn't read the relays right now. {error}</p>}

      {shown === null && !error && (
        <ol className="ledger-rows" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="ledger-row skeleton"><span /><span /><span /></li>
          ))}
        </ol>
      )}

      {shown && shown.length === 0 && (
        <div className="ledger-empty">
          <p>No passports stamped yet. The first one could be yours.</p>
          <button className="btn" onClick={onGetPassport}>Get a passport</button>
        </div>
      )}

      {shown && shown.length > 0 && (
        <ol className="ledger-rows">
          {shown.map(({ claim, profile, status }) => {
            const pk = claim.event.pubkey;
            const npub = npubOf(pk);
            const name = profile?.display_name || profile?.name || `${npub.slice(0, 12)}…`;
            const q = profile?.nip05 && !profile.nip05.startsWith("_@") ? profile.nip05 : npub;
            return (
              <li key={pk} className="ledger-row">
                <span className="ledger-avatar">
                  {profile?.picture ? <img src={profile.picture} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span aria-hidden="true">{name.slice(0, 1)}</span>}
                </span>
                <span className="ledger-who">
                  <strong>{name}</strong>
                  <span>{profile?.nip05?.replace(/^_@/, "") || `${npub.slice(0, 16)}…`}</span>
                </span>
                <span className="ledger-addr mono">{claim.address.replace("bitcoincash:", "").slice(0, 10)}…</span>
                <span className={`ledger-status ${status}`}>{status === "verified" ? "Verified" : "Checking"}</span>
                <span className="ledger-date">{new Date(claim.event.created_at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                <button className="btn btn-ghost btn-small" onClick={() => onInspect(q)}>
                  {status === "verified" ? "Open and pay" : "Open"}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

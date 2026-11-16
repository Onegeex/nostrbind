import { useCallback, useEffect, useRef, useState } from "react";
import { isValidAddress } from "./lib/bch";
import { EXPLORER_TX } from "./lib/config";
import { fetchProfile, resolvePubkey, type Profile } from "./lib/nostr";
import { verifyAddress, verifyPubkey, type VerifyResult } from "./lib/verify";
import { nameOwner } from "./lib/names";
import { Passport, type PassportData } from "./components/Passport";
import { PayPanel, shareLinkFor } from "./components/PayPanel";
import { Directory } from "./components/Directory";
import { Bind } from "./components/Bind";
import { errMsg, WalletButton, WalletProvider } from "./components/wallet";
import "./App.css";

type View = "inspect" | "apply";

const SPECIMEN: PassportData = {
  pubkey: "0".repeat(64),
  profile: { name: "Ada Okonkwo" },
  boundName: `ada@${location.host}`,
  address: "bitcoincash:qrspecimen7x4a9m2d0v5k8w3n6c1e4j9h2p5s8u",
  boundAt: 1794700800,
  verified: true,
  checks: [
    { label: "Nostr key signed a binding to this address", ok: true },
    { label: "Bitcoin Cash transaction records this Nostr key", ok: true },
    { label: "That transaction was signed by this address", ok: true },
  ],
};

function Inspect({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const [input, setInput] = useState(query);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [boundName, setBoundName] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProfile(null);
    setBoundName(undefined);
    try {
      let r: VerifyResult | null;
      if (isValidAddress(q)) {
        r = await verifyAddress(q);
        if (!r) throw new Error("This Bitcoin Cash address has no NostrBind passport.");
      } else {
        const pk = await resolvePubkey(q);
        if (!pk) throw new Error("That isn't an npub, a Nostr address like name@domain.com, or a Bitcoin Cash address.");
        r = await verifyPubkey(pk);
      }
      const [p, owner] = await Promise.all([
        fetchProfile(r.pubkey).catch(() => null),
        r.verified && r.name ? nameOwner(r.name).catch(() => null) : Promise.resolve(null),
      ]);
      setProfile(p);
      if (owner && owner === r.pubkey && r.name) setBoundName(`${r.name}@${location.host}`);
      setResult(r);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setInput(query);
    if (query) void run(query);
    else {
      setResult(null);
      setError(null);
    }
  }, [query, run]);

  const name = profile?.display_name || profile?.name || "this person";

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>A passport for your Nostr identity, stamped on Bitcoin Cash.</h1>
          <p className="lede">
            Bind your npub to a BCH address with two public proofs that point at each other. Anyone can check them in
            their browser and pay you, with no account and no middleman.
          </p>
          <form
            className="inspect"
            onSubmit={(e) => {
              e.preventDefault();
              onQuery(input.trim());
            }}
          >
            <label htmlFor="q">Check someone's passport</label>
            <div className="inspect-row">
              <input
                id="q"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="npub1…, name@domain.com or bitcoincash:q…"
                autoComplete="off"
                spellCheck={false}
              />
              <button className="btn" disabled={busy}>{busy ? "Checking…" : "Check"}</button>
            </div>
          </form>
          {busy && <p className="hint">Reading Nostr relays and the Bitcoin Cash chain…</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
        <div className="hero-specimen" aria-label="Example passport">
          <Passport data={SPECIMEN} specimen stampKey="specimen" />
        </div>
      </section>

      {result && (
        <section className="result" ref={resultRef} aria-label="Passport check result">
          <Passport
            data={{ ...result, profile, boundName }}
            stampKey={result.pubkey + String(result.verified)}
            explorerUrl={EXPLORER_TX}
          />
          {result.verified && result.address ? (
            <PayPanel
              to={result.address}
              recipient={result.pubkey}
              name={name}
              link={shareLinkFor(result.pubkey, boundName ?? profile?.nip05)}
            />
          ) : (
            <aside className="panel">
              <h3>No payment for this one</h3>
              <p className="hint">
                Paying is only offered when every proof checks out. The crossed lines on the passport show what's
                missing. If this is your key, get a passport to fix it.
              </p>
            </aside>
          )}
        </section>
      )}
    </>
  );
}

function HowItWorks() {
  return (
    <section className="proofs" aria-labelledby="proofs-title">
      <h2 id="proofs-title">Why the stamp can't be faked</h2>
      <div className="proof-pair">
        <div className="proof">
          <h3>Recorded on Bitcoin Cash</h3>
          <p>
            Your wallet spends from your address and writes your Nostr key into the transaction. Only whoever holds
            that address's key can make it.
          </p>
          <pre className="mono">OP_RETURN "NBND" 01{"\n"}  &lt;your 32-byte Nostr key&gt;</pre>
        </div>
        <div className="proof-bond" aria-hidden="true">
          <svg viewBox="0 0 64 120"><circle cx="24" cy="60" r="18" /><circle cx="40" cy="60" r="18" /></svg>
        </div>
        <div className="proof">
          <h3>Signed with your Nostr key</h3>
          <p>
            Then your Nostr key signs a note naming that address and transaction. Only whoever holds the Nostr key can
            sign it.
          </p>
          <pre className="mono">["i", "bch:bitcoincash:q…",{"\n"}      "&lt;transaction id&gt;"]</pre>
        </div>
      </div>
      <p className="proofs-foot">
        Each proof names the other, so neither key can claim the other alone. Bind again and the newest pair replaces
        the old one.
      </p>
    </section>
  );
}

function Shell() {
  const params = new URLSearchParams(location.search);
  const [view, setView] = useState<View>(params.has("apply") || params.has("bind") ? "apply" : "inspect");
  const [query, setQuery] = useState(params.get("q") ?? "");

  const go = (v: View, q?: string) => {
    setView(v);
    if (q !== undefined) setQuery(q);
    const url = v === "apply" ? "?apply" : q ? `?q=${encodeURIComponent(q)}` : location.pathname;
    history.pushState(null, "", url);
    if (v === "apply") window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(location.search);
      setView(p.has("apply") ? "apply" : "inspect");
      setQuery(p.get("q") ?? "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="page">
      <header className="masthead">
        <a className="wordmark" href="/" onClick={(e) => { e.preventDefault(); go("inspect", ""); }}>
          <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="12" cy="16" r="8" /><circle cx="20" cy="16" r="8" /></svg>
          NostrBind
        </a>
        <nav aria-label="Main">
          <button className={view === "inspect" ? "on" : ""} onClick={() => go("inspect", query)}>Check a passport</button>
          <button className={view === "apply" ? "on" : ""} onClick={() => go("apply")}>Get a passport</button>
        </nav>
        <WalletButton quiet />
      </header>

      <main>
        {view === "inspect" ? (
          <>
            <Inspect query={query} onQuery={(q) => go("inspect", q)} />
            <Directory onInspect={(q) => { go("inspect", q); window.scrollTo({ top: 0, behavior: "smooth" }); }} onGetPassport={() => go("apply")} />
            <HowItWorks />
          </>
        ) : (
          <Bind onDone={(q) => go("inspect", q)} />
        )}
      </main>

      <footer className="colophon">
        <p>
          Built for BCH BLAZE 2026. Open source on <a href="https://github.com/Onegeex/nostrbind" target="_blank" rel="noreferrer">GitHub</a>.
          Nothing here holds your keys or your coins.
        </p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <Shell />
    </WalletProvider>
  );
}

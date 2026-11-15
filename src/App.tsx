import { useCallback, useEffect, useState } from "react";
import { useWizardConnect, WizardConnectQRDialog } from "@wizardconnect/react";
import type { DappConnectionManager } from "@wizardconnect/dapp";
import { DEMO_LOOKUP, EXPLORER_TX } from "./lib/config";
import {
  bchToSats,
  buildCommitmentTx,
  buildPaymentTx,
  isValidAddress,
  satsToBch,
} from "./lib/bch";
import {
  bindingTemplate,
  extensionSigner,
  fetchBinding,
  fetchProfile,
  forgetLocalKey,
  hasExtension,
  localNsec,
  localSigner,
  npubOf,
  publish,
  resolvePubkey,
  shortNpub,
  type NostrSigner,
  type Profile,
} from "./lib/nostr";
import { verifyAddress, verifyPubkey, type VerifyResult } from "./lib/verify";
import { scanWallet, signAndBroadcast, type WalletScan } from "./lib/wallet";
import "./App.css";

type Tab = "lookup" | "bind";

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function Short({ text, head = 16, tail = 6 }: { text: string; head?: number; tail?: number }) {
  return <span title={text}>{text.length > head + tail + 1 ? `${text.slice(0, head)}…${text.slice(-tail)}` : text}</span>;
}

// ---------------- wallet (WizardConnect) ----------------

function useWallet() {
  const wc = useWizardConnect({ dappName: "NostrBind", dappIcon: `${location.origin}/favicon.svg` });
  const [scan, setScan] = useState<WalletScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const rescan = useCallback(async () => {
    if (!wc.manager) return;
    setScanning(true);
    setScanError(null);
    try {
      setScan(await scanWallet(wc.manager));
    } catch (e) {
      setScanError(errMsg(e));
    } finally {
      setScanning(false);
    }
  }, [wc.manager]);

  useEffect(() => {
    if (wc.state === "connected" && wc.manager?.hasPath(0)) void rescan();
    if (wc.state !== "connected") setScan(null);
  }, [wc.state, wc.manager, rescan]);

  // Paths can arrive a moment after "connected"; rescan on walletready too.
  useEffect(() => {
    const m = wc.manager;
    if (!m) return;
    const onReady = () => void rescan();
    m.on("walletready", onReady);
    return () => {
      m.off("walletready", onReady);
    };
  }, [wc.manager, rescan]);

  return { wc, scan, scanning, scanError, rescan };
}

type Wallet = ReturnType<typeof useWallet>;

function WalletButton({ wallet }: { wallet: Wallet }) {
  const { wc } = wallet;
  return (
    <>
      {wc.state === "connected" ? (
        <button className="chip" onClick={() => void wc.disconnect()} title="Disconnect wallet">
          <span className="dot ok" /> {wc.walletName ?? "Wallet"} · disconnect
        </button>
      ) : (
        <button className="btn" onClick={() => wc.connect()} disabled={wc.state === "connecting"}>
          {wc.state === "connecting" ? "Waiting for wallet…" : "Connect BCH wallet"}
        </button>
      )}
      {wc.uri && wc.qrUri && (
        <WizardConnectQRDialog
          show={wc.state === "connecting"}
          onClose={() => void wc.disconnect()}
          uri={wc.uri}
          qrUri={wc.qrUri}
          subtitle="Scan with a WizardConnect wallet (e.g. Cashonize)"
        />
      )}
      {wc.error && <p className="error">{wc.error}</p>}
    </>
  );
}

// ---------------- profile card + pay ----------------

function PayBox({ to, wallet }: { to: string; wallet: Wallet }) {
  const [amount, setAmount] = useState("0.0001");
  const [busy, setBusy] = useState(false);
  const [txid, setTxid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const m = wallet.wc.manager;

  async function pay() {
    if (!m || !wallet.scan?.firstChange) return;
    setBusy(true);
    setError(null);
    setTxid(null);
    try {
      const sats = bchToSats(amount);
      const unsigned = buildPaymentTx(wallet.scan.utxos, to, sats, wallet.scan.firstChange.lockingBytecode);
      const id = await signAndBroadcast(m, unsigned, `NostrBind: send ${amount} BCH to a verified Nostr identity`);
      setTxid(id);
      void wallet.rescan();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pay">
      <h3>Pay this person in BCH</h3>
      {wallet.wc.state !== "connected" ? (
        <WalletButton wallet={wallet} />
      ) : (
        <>
          <div className="row">
            <input
              className="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Amount in BCH"
            />
            <span className="unit">BCH</span>
            <button className="btn primary" onClick={pay} disabled={busy || wallet.scanning || !wallet.scan}>
              {busy ? "Confirm in wallet…" : "Pay"}
            </button>
          </div>
          {wallet.scan && (
            <p className="muted small">
              Wallet balance: {satsToBch(wallet.scan.utxos.filter((u) => !u.hasToken).reduce((s, u) => s + u.value, 0n))} BCH
            </p>
          )}
        </>
      )}
      {txid && (
        <p className="success">
          Sent. <a href={EXPLORER_TX(txid)} target="_blank" rel="noreferrer">View transaction</a>
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function ProfileCard({ result, profile, wallet }: { result: VerifyResult; profile: Profile | null; wallet: Wallet }) {
  const name = profile?.display_name || profile?.name || shortNpub(result.pubkey);
  return (
    <section className={`card ${result.verified ? "verified" : "unverified"}`}>
      <header className="profile">
        {profile?.picture ? <img src={profile.picture} alt="" className="avatar" /> : <div className="avatar placeholder" />}
        <div>
          <h2>{name}</h2>
          <p className="mono small"><Short text={npubOf(result.pubkey)} head={20} tail={8} /></p>
          {profile?.nip05 && <p className="small muted">{profile.nip05}</p>}
        </div>
        <span className={`badge ${result.verified ? "ok" : "bad"}`}>{result.verified ? "Verified" : "Not verified"}</span>
      </header>

      {result.address && (
        <p className="addr">
          BCH address: <span className="mono"><Short text={result.address} head={22} tail={8} /></span>
          <button className="link" onClick={() => void navigator.clipboard.writeText(result.address!)}>copy</button>
        </p>
      )}

      <ul className="checks">
        {result.checks.map((c, i) => (
          <li key={i} className={c.ok ? "ok" : "bad"}>
            <span className="mark">{c.ok ? "✓" : "✗"}</span>
            <span>
              {c.label}
              {c.detail && <span className="muted small"> · {c.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      {result.txid && (
        <p className="small">
          <a href={EXPLORER_TX(result.txid)} target="_blank" rel="noreferrer">Commitment transaction</a>
          {result.boundAt && <span className="muted"> · bound {new Date(result.boundAt * 1000).toLocaleDateString()}</span>}
        </p>
      )}

      {result.verified && result.address && <PayBox to={result.address} wallet={wallet} />}
    </section>
  );
}

// ---------------- look up ----------------

function Lookup({ wallet, initial }: { wallet: Wallet; initial: string }) {
  const [query, setQuery] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProfile(null);
    try {
      let r: VerifyResult | null;
      if (isValidAddress(q)) {
        r = await verifyAddress(q);
        if (!r) throw new Error("This BCH address has no NostrBind commitment.");
      } else {
        const pk = await resolvePubkey(q);
        if (!pk) throw new Error("Enter an npub, a NIP-05 name (name@domain) or a BCH address.");
        r = await verifyPubkey(pk);
      }
      setResult(r);
      history.replaceState(null, "", `?q=${encodeURIComponent(q.trim())}`);
      setProfile(await fetchProfile(r.pubkey));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initial) void run(initial);
  }, [initial, run]);

  return (
    <>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="npub…, name@domain, or bitcoincash:q…"
          aria-label="Search"
        />
        <button className="btn primary" disabled={busy}>{busy ? "Checking…" : "Verify"}</button>
      </form>
      {!result && !busy && DEMO_LOOKUP && (
        <p className="muted small">
          New here? <button className="link" onClick={() => { setQuery(DEMO_LOOKUP); void run(DEMO_LOOKUP); }}>Try the demo profile</button>
        </p>
      )}
      {busy && <p className="muted">Reading Nostr relays and the BCH chain…</p>}
      {error && <p className="error">{error}</p>}
      {result && <ProfileCard result={result} profile={profile} wallet={wallet} />}
    </>
  );
}

// ---------------- bind ----------------

function Bind({ wallet, onDone }: { wallet: Wallet; onDone: (q: string) => void }) {
  const [signer, setSigner] = useState<NostrSigner | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNsec, setShowNsec] = useState(false);
  const scan = wallet.scan;

  useEffect(() => {
    if (!signer) return;
    fetchBinding(signer.pubkey).then((b) => setExisting(b ? b.address : null)).catch(() => {});
  }, [signer]);

  useEffect(() => {
    if (scan?.funded.length && !chosen) setChosen(scan.funded[0].address.address);
  }, [scan, chosen]);

  async function useExtension() {
    setError(null);
    try {
      setSigner(await extensionSigner());
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function bind() {
    const m: DappConnectionManager | null = wallet.wc.manager;
    if (!signer || !m || !scan) return;
    const entry = scan.funded.find((f) => f.address.address === chosen);
    if (!entry) return;
    setError(null);
    try {
      setBusy("Approve the transaction in your wallet…");
      const unsigned = buildCommitmentTx(entry.coins, signer.pubkey);
      const txid = await signAndBroadcast(m, unsigned, "NostrBind: link your Nostr identity to this address");
      setBusy("Sign the binding with your Nostr key…");
      const event = await signer.sign(bindingTemplate(entry.address.address, txid));
      setBusy("Publishing to Nostr relays…");
      await publish(event);
      setBusy(null);
      void wallet.rescan();
      onDone(npubOf(signer.pubkey));
    } catch (e) {
      setBusy(null);
      setError(errMsg(e));
    }
  }

  return (
    <section className="card">
      <ol className="steps">
        <li className={signer ? "done" : ""}>
          <h3>1. Your Nostr identity</h3>
          {signer ? (
            <>
              <p className="mono small"><Short text={npubOf(signer.pubkey)} head={20} tail={8} /></p>
              {existing && <p className="muted small">Already bound to <span className="mono"><Short text={existing} /></span>. Binding again replaces it.</p>}
              {signer.kind === "local" && (
                <p className="small">
                  This key lives only in this browser.{" "}
                  <button className="link" onClick={() => setShowNsec((s) => !s)}>{showNsec ? "Hide" : "Back it up"}</button>
                  {" · "}
                  <button className="link" onClick={() => { forgetLocalKey(); setSigner(null); }}>Forget</button>
                  {showNsec && <span className="mono nsec">{localNsec()}</span>}
                </p>
              )}
            </>
          ) : (
            <div className="row">
              <button className="btn" onClick={useExtension} disabled={!hasExtension()} title={hasExtension() ? "" : "No Nostr extension detected"}>
                Use Nostr extension
              </button>
              <button className="btn" onClick={() => setSigner(localSigner())}>Create a key here</button>
            </div>
          )}
        </li>

        <li className={wallet.wc.state === "connected" ? "done" : ""}>
          <h3>2. Your BCH wallet</h3>
          <WalletButton wallet={wallet} />
          {wallet.scanning && <p className="muted small">Looking for your coins…</p>}
          {wallet.scanError && <p className="error">{wallet.scanError}</p>}
          {scan && scan.funded.length > 0 && (
            <label className="small">
              Identity address (people will pay this one)
              <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
                {scan.funded.map((f) => (
                  <option key={f.address.address} value={f.address.address}>
                    {f.address.address.slice(12, 28)}… · {satsToBch(f.balance)} BCH
                  </option>
                ))}
              </select>
            </label>
          )}
          {scan && scan.funded.length === 0 && (
            <p className="small">
              No BCH found. Send about 0.0001 BCH to{" "}
              <span className="mono">{scan.firstReceive?.address}</span>, then{" "}
              <button className="link" onClick={() => void wallet.rescan()}>check again</button>.
            </p>
          )}
        </li>

        <li>
          <h3>3. Bind them</h3>
          <p className="muted small">
            Your wallet signs one small BCH transaction recording your Nostr key (fee under 0.00001 BCH, change comes back to you). Then your Nostr key signs a note naming your BCH address. Both proofs are public and anyone can re-check them.
          </p>
          <button
            className="btn primary"
            onClick={bind}
            disabled={!signer || !scan || !chosen || !!busy}
          >
            {busy ?? "Bind my identity"}
          </button>
        </li>
      </ol>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// ---------------- app ----------------

export default function App() {
  const wallet = useWallet();
  const params = new URLSearchParams(location.search);
  const [tab, setTab] = useState<Tab>(params.get("bind") !== null ? "bind" : "lookup");
  const [lookupQuery, setLookupQuery] = useState(params.get("q") ?? "");

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">⛓</span> NostrBind
        </div>
        <WalletButton wallet={wallet} />
      </header>

      <main>
        <section className="hero">
          <h1>Pay any Nostr user in Bitcoin Cash, and know it's really them.</h1>
          <p className="muted">
            NostrBind links a Nostr key to a BCH address with proof on both sides: a Nostr signature and an on-chain transaction. No accounts, no custodians, checked in your browser.
          </p>
        </section>

        <nav className="tabs">
          <button className={tab === "lookup" ? "active" : ""} onClick={() => setTab("lookup")}>Look up &amp; pay</button>
          <button className={tab === "bind" ? "active" : ""} onClick={() => setTab("bind")}>Bind my identity</button>
        </nav>

        {tab === "lookup" ? (
          <Lookup key={lookupQuery} wallet={wallet} initial={lookupQuery} />
        ) : (
          <Bind
            wallet={wallet}
            onDone={(q) => {
              setLookupQuery(q);
              setTab("lookup");
            }}
          />
        )}
      </main>

      <footer className="muted small">
        Built for BCH BLAZE 2026 · <a href="https://github.com/Onegeex/nostrbind" target="_blank" rel="noreferrer">Source</a> · Proofs: Nostr event kind 30078 + OP_RETURN "NBND"
      </footer>
    </div>
  );
}

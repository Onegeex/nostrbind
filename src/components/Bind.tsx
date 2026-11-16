import { useEffect, useState } from "react";
import { buildCommitmentTx, satsToBch } from "../lib/bch";
import {
  bindingTemplate,
  extensionSigner,
  fetchBinding,
  forgetLocalKey,
  hasExtension,
  localNsec,
  localSigner,
  npubOf,
  publish,
  type NostrSigner,
} from "../lib/nostr";
import { signAndBroadcast } from "../lib/wallet";
import { nameError, nameOwner, normaliseName } from "../lib/names";
import { setProfileNip05 } from "../lib/nostr";
import { errMsg, useWallet, WalletButton } from "./wallet";

export function Bind({ onDone }: { onDone: (q: string) => void }) {
  const wallet = useWallet();
  const [signer, setSigner] = useState<NostrSigner | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNsec, setShowNsec] = useState(false);
  const [name, setName] = useState("");
  const [nameState, setNameState] = useState<"idle" | "checking" | "free" | "yours" | "taken" | "unknown">("idle");
  const [done, setDone] = useState<{ npub: string; name?: string } | null>(null);
  const [profileState, setProfileState] = useState<"idle" | "saving" | "saved">("idle");
  const host = location.host;
  const cleanName = normaliseName(name);
  const nameProblem = nameError(cleanName);
  const scan = wallet.scan;
  const connected = wallet.wc.state === "connected";

  useEffect(() => {
    if (!signer) return;
    fetchBinding(signer.pubkey).then((b) => setExisting(b ? b.address : null)).catch(() => {});
  }, [signer]);

  useEffect(() => {
    if (scan?.funded.length && !chosen) setChosen(scan.funded[0].address.address);
  }, [scan, chosen]);

  useEffect(() => {
    if (!cleanName || nameProblem) {
      setNameState("idle");
      return;
    }
    setNameState("checking");
    const t = setTimeout(() => {
      nameOwner(cleanName)
        .then((owner) => setNameState(!owner ? "free" : owner === signer?.pubkey ? "yours" : "taken"))
        .catch(() => setNameState("unknown"));
    }, 450);
    return () => clearTimeout(t);
  }, [cleanName, nameProblem, signer]);

  async function addToProfile() {
    if (!signer || !done?.name) return;
    setProfileState("saving");
    setError(null);
    try {
      await setProfileNip05(signer, `${done.name}@${host}`);
      setProfileState("saved");
    } catch (e) {
      setProfileState("idle");
      setError(errMsg(e));
    }
  }

  async function useExtension() {
    setError(null);
    try {
      setSigner(await extensionSigner());
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function bind() {
    const m = wallet.wc.manager;
    if (!signer || !m || !scan) return;
    const entry = scan.funded.find((f) => f.address.address === chosen);
    if (!entry) return;
    setError(null);
    try {
      setBusy("Approve the transaction in your wallet…");
      const unsigned = buildCommitmentTx(entry.coins, signer.pubkey);
      const txid = await signAndBroadcast(m, unsigned, "NostrBind: link your Nostr key to this address");
      setBusy("Sign the binding with your Nostr key…");
      const claimName = cleanName && !nameProblem && nameState !== "taken" ? cleanName : undefined;
      const event = await signer.sign(bindingTemplate(entry.address.address, txid, claimName));
      setBusy("Publishing to Nostr relays…");
      await publish(event);
      setBusy(null);
      void wallet.rescan();
      setDone({ npub: npubOf(signer.pubkey), name: claimName });
    } catch (e) {
      setBusy(null);
      setError(errMsg(e));
    }
  }

  if (done) {
    return (
      <section className="apply apply-done" aria-labelledby="done-title">
        <div className="apply-intro">
          <h1 id="done-title">Stamped.</h1>
          <p>Your passport is live on Nostr and Bitcoin Cash. It can take a few seconds for relays to show it everywhere.</p>
        </div>
        <div className="done-card">
          {done.name ? (
            <>
              <h2>{done.name}@{host}</h2>
              <p className="hint">
                Add this name to your Nostr profile so clients like Damus and Primal show it. This republishes your
                profile with the name set and keeps everything else.
              </p>
              {profileState === "saved" ? (
                <p className="saved">Added to your profile.</p>
              ) : (
                <button className="btn" onClick={addToProfile} disabled={profileState === "saving"}>
                  {profileState === "saving" ? "Sign in your Nostr extension…" : "Add it to my Nostr profile"}
                </button>
              )}
            </>
          ) : (
            <p className="hint">No name this time. Bind again any time to claim one.</p>
          )}
          <button className="btn btn-pay" onClick={() => onDone(done.name ? `${done.name}@${host}` : done.npub)}>
            Open my passport
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </section>
    );
  }

  const step1 = !!signer;
  const step2 = connected && !!scan && scan.funded.length > 0;

  return (
    <section className="apply" aria-labelledby="apply-title">
      <div className="apply-intro">
        <h1 id="apply-title">Get your passport</h1>
        <p>
          Two approvals, about a minute. Your wallet records your Nostr key in a small Bitcoin Cash transaction, then your
          Nostr key signs a note naming your BCH address. The change comes back to you; the only cost is a network fee of
          about 250 satoshis.
        </p>
      </div>

      <ol className="apply-steps">
        <li className={step1 ? "done" : "current"}>
          <h2>Choose your Nostr key</h2>
          {signer ? (
            <div className="step-result">
              <p className="mono">{npubOf(signer.pubkey).slice(0, 24)}…{npubOf(signer.pubkey).slice(-8)}</p>
              {existing && <p className="hint">This key is already bound to {existing.replace("bitcoincash:", "").slice(0, 12)}…. Binding again replaces it.</p>}
              {signer.kind === "local" && (
                <p className="hint">
                  This key lives only in this browser.{" "}
                  <button className="link" onClick={() => setShowNsec((s) => !s)}>{showNsec ? "Hide it" : "Back it up"}</button>{" "}
                  or <button className="link" onClick={() => { forgetLocalKey(); setSigner(null); }}>use a different key</button>.
                  {showNsec && <span className="nsec mono">{localNsec()}</span>}
                </p>
              )}
            </div>
          ) : (
            <div className="step-actions">
              <button className="btn" onClick={useExtension} disabled={!hasExtension()}>
                Use my Nostr extension
              </button>
              <button className="btn btn-ghost" onClick={() => setSigner(localSigner())}>
                Create a new key here
              </button>
              {!hasExtension() && <p className="hint">No Nostr extension found. Alby and nos2x both work.</p>}
            </div>
          )}
        </li>

        <li className={step2 ? "done" : step1 ? "current" : ""}>
          <h2>Connect your Bitcoin Cash wallet</h2>
          <div className="step-actions">
            <WalletButton />
          </div>
          {wallet.scanning && <p className="hint">Looking for your coins…</p>}
          {wallet.scanError && <p className="error">{wallet.scanError}</p>}
          {scan && scan.funded.length > 0 && (
            <label className="field">
              <span>Address people will pay</span>
              <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
                {scan.funded.map((f) => (
                  <option key={f.address.address} value={f.address.address}>
                    {f.address.address.replace("bitcoincash:", "").slice(0, 18)}… holding {satsToBch(f.balance)} BCH
                  </option>
                ))}
              </select>
            </label>
          )}
          {scan && scan.funded.length === 0 && (
            <p className="hint">
              Your wallet has no BCH yet. Send about 0.001 BCH to <span className="mono">{scan.firstReceive?.address}</span>, then{" "}
              <button className="link" onClick={() => void wallet.rescan()}>check again</button>.
            </p>
          )}
        </li>

        <li className={step1 && step2 ? "current" : ""}>
          <h2>Stamp it</h2>
          <label className="field name-field">
            <span>Free name (optional)</span>
            <span className="name-input">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="yourname"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="name-help"
              />
              <span className="name-host">@{host}</span>
            </span>
            <span id="name-help" className={`name-status ${nameState}`}>
              {nameProblem ??
                {
                  idle: "A Nostr address any client can check. You keep it while your passport verifies.",
                  checking: "Checking…",
                  free: "Available.",
                  yours: "Already yours.",
                  taken: "Taken by an earlier passport. Pick another, or bind without a name.",
                  unknown: "Couldn't check right now. You can still try it.",
                }[nameState]}
            </span>
          </label>
          <button className="btn btn-pay" onClick={bind} disabled={!signer || !scan || !chosen || !!busy || (!!cleanName && !!nameProblem)}>
            {busy ?? "Bind my Nostr key to this address"}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </li>
      </ol>
    </section>
  );
}

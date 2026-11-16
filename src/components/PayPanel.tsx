import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { bchToSats, buildPaymentTx, satsToBch } from "../lib/bch";
import { EXPLORER_TX } from "../lib/config";
import { extensionSigner, hasExtension, localNsec, localSigner, paymentNoteTemplate, publish } from "../lib/nostr";
import { signAndBroadcast } from "../lib/wallet";
import { errMsg, useWallet, WalletButton } from "./wallet";

const PRESETS = ["0.0005", "0.001", "0.005"];

export function shareLinkFor(pubkey: string, nip05?: string): string {
  const q = nip05 && !nip05.startsWith("_@") ? nip05 : pubkey;
  return `${location.origin}/?q=${encodeURIComponent(q)}`;
}

function ShareBox({ link }: { link: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 240, color: { dark: "#1C1A45", light: "#00000000" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [link]);
  return (
    <div className="share">
      {qr && <img className="share-qr" src={qr} alt="QR code for this passport's link" width={120} height={120} />}
      <div>
        <h3>Share this passport</h3>
        <p className="hint">Put the link in a Nostr bio so people can check you and pay you.</p>
        <div className="share-link">
          <input readOnly value={link} aria-label="Passport link" onFocus={(e) => e.currentTarget.select()} />
          <button
            className="btn btn-ghost btn-small"
            onClick={() => {
              void navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PayPanel({ to, recipient, name, link }: { to: string; recipient: string; name: string; link: string }) {
  const wallet = useWallet();
  const [amount, setAmount] = useState("0.001");
  const [busy, setBusy] = useState(false);
  const [txid, setTxid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noted, setNoted] = useState<"idle" | "posting" | "posted">("idle");
  const connected = wallet.wc.state === "connected";
  const balance = wallet.scan ? wallet.scan.utxos.filter((u) => !u.hasToken).reduce((s, u) => s + u.value, 0n) : null;

  async function pay() {
    const m = wallet.wc.manager;
    if (!m || !wallet.scan?.firstChange) return;
    setBusy(true);
    setError(null);
    setTxid(null);
    setNoted("idle");
    try {
      const sats = bchToSats(amount);
      const unsigned = buildPaymentTx(wallet.scan.utxos, to, sats, wallet.scan.firstChange.lockingBytecode);
      const id = await signAndBroadcast(m, unsigned, `NostrBind: pay ${amount} BCH to ${name}`);
      setTxid(id);
      void wallet.rescan();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function postNote() {
    setNoted("posting");
    setError(null);
    try {
      const signer = hasExtension() ? await extensionSigner() : localNsec() ? localSigner() : null;
      if (!signer) throw new Error("Connect a Nostr extension, or create a key on the Get a passport page, to post.");
      await publish(await signer.sign(paymentNoteTemplate(recipient, amount, link)));
      setNoted("posted");
    } catch (e) {
      setNoted("idle");
      setError(errMsg(e));
    }
  }

  return (
    <aside className="panel">
      <div className="pay">
        <h3>Pay {name} in Bitcoin Cash</h3>
        <p className="hint">Goes straight to the address on this passport. Nobody holds the money in between.</p>
        {!connected ? (
          <WalletButton />
        ) : (
          <>
            <div className="amount-row">
              <label className="amount">
                <span className="sr-only">Amount in BCH</span>
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <span className="unit">BCH</span>
              </label>
              <div className="presets" role="group" aria-label="Quick amounts">
                {PRESETS.map((p) => (
                  <button key={p} className={`preset ${amount === p ? "on" : ""}`} onClick={() => setAmount(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn btn-pay" onClick={pay} disabled={busy || wallet.scanning || !wallet.scan}>
              {busy ? "Approve in your wallet…" : `Pay ${amount} BCH`}
            </button>
            {balance !== null && <p className="hint">Your wallet holds {satsToBch(balance)} BCH</p>}
          </>
        )}
        {txid && (
          <div className="paid">
            <p>
              Paid. <a href={EXPLORER_TX(txid)} target="_blank" rel="noreferrer">See the transaction</a>
            </p>
            {noted === "posted" ? (
              <p className="hint">Posted to Nostr.</p>
            ) : (
              <button className="btn btn-ghost btn-small" onClick={postNote} disabled={noted === "posting"}>
                {noted === "posting" ? "Posting…" : "Tell Nostr you paid"}
              </button>
            )}
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <ShareBox link={link} />
    </aside>
  );
}

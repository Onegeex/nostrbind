import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useWizardConnect, WizardConnectQRDialog } from "@wizardconnect/react";
import { scanWallet, type WalletScan } from "../lib/wallet";

export function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function useWalletState() {
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

export type Wallet = ReturnType<typeof useWalletState>;

const Ctx = createContext<Wallet | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const w = useWalletState();
  const { wc } = w;
  return (
    <Ctx.Provider value={w}>
      {children}
      {wc.uri && wc.qrUri && (
        <WizardConnectQRDialog
          show={wc.state === "connecting"}
          onClose={() => void wc.disconnect()}
          uri={wc.uri}
          qrUri={wc.qrUri}
          subtitle="Scan with a WizardConnect wallet such as Cashonize"
        />
      )}
    </Ctx.Provider>
  );
}

export function useWallet(): Wallet {
  const w = useContext(Ctx);
  if (!w) throw new Error("useWallet outside WalletProvider");
  return w;
}

export function WalletButton({ quiet = false }: { quiet?: boolean }) {
  const { wc } = useWallet();
  if (wc.state === "connected") {
    return (
      <button className="wallet-chip" onClick={() => void wc.disconnect()} title="Disconnect your wallet">
        <span className="led" aria-hidden="true" />
        {wc.walletName ?? "Wallet"} connected
        <span className="wallet-chip-x">Disconnect</span>
      </button>
    );
  }
  return (
    <button className={quiet ? "btn btn-ghost" : "btn"} onClick={() => wc.connect()} disabled={wc.state === "connecting"}>
      {wc.state === "connecting" ? "Waiting for your wallet…" : "Connect BCH wallet"}
    </button>
  );
}

// WizardConnect wallet helpers: derive the wallet's addresses, find coins, sign + broadcast.
import type { DappConnectionManager } from "@wizardconnect/dapp";
import { encodeLockingBytecodeP2pkh, hash160 } from "@bitauth/libauth";
import { SCAN_CHANGE, SCAN_RECEIVE } from "./config";
import { lockingBytecodeToAddress, type PathName, type UnsignedTx, type Utxo } from "./bch";
import { broadcast, listUnspent } from "./chain";

const CHILD: Record<PathName, number> = { receive: 0, change: 1 };

export interface WalletAddress {
  path: PathName;
  index: number;
  address: string;
  lockingBytecode: Uint8Array;
}

export function deriveAddress(m: DappConnectionManager, path: PathName, index: number): WalletAddress | null {
  const pk = m.getPubkey(CHILD[path], BigInt(index));
  if (!pk) return null;
  const lockingBytecode = encodeLockingBytecodeP2pkh(hash160(pk));
  return { path, index, address: lockingBytecodeToAddress(lockingBytecode), lockingBytecode };
}

export interface WalletScan {
  utxos: Utxo[];
  /** Addresses holding plain BCH, with their balance; candidates for the identity address. */
  funded: { address: WalletAddress; balance: bigint; coins: Utxo[] }[];
  firstReceive: WalletAddress | null;
  firstChange: WalletAddress | null;
}

export async function scanWallet(m: DappConnectionManager): Promise<WalletScan> {
  const addrs: WalletAddress[] = [];
  for (let i = 0; i < SCAN_RECEIVE; i++) {
    const a = deriveAddress(m, "receive", i);
    if (a) addrs.push(a);
  }
  for (let i = 0; i < SCAN_CHANGE; i++) {
    const a = deriveAddress(m, "change", i);
    if (a) addrs.push(a);
  }
  const perAddr = await Promise.all(
    addrs.map(async (a) => ({ a, coins: await listUnspent(a.lockingBytecode, a.path, a.index) })),
  );
  const utxos = perAddr.flatMap((p) => p.coins);
  const funded = perAddr
    .map((p) => {
      const plain = p.coins.filter((c) => !c.hasToken);
      return { address: p.a, balance: plain.reduce((s, c) => s + c.value, 0n), coins: plain };
    })
    .filter((f) => f.balance > 0n)
    .sort((x, y) => (y.balance > x.balance ? 1 : -1));
  return {
    utxos,
    funded,
    firstReceive: deriveAddress(m, "receive", 0),
    firstChange: deriveAddress(m, "change", 0),
  };
}

export async function signAndBroadcast(
  m: DappConnectionManager,
  unsigned: UnsignedTx,
  userPrompt: string,
): Promise<string> {
  const resp = await m.signTransaction({
    transaction: {
      transaction: unsigned.transaction,
      sourceOutputs: unsigned.sourceOutputs,
      broadcast: false,
      userPrompt,
    },
    inputPaths: unsigned.inputPaths,
  });
  if (resp.error) throw new Error(`Wallet declined: ${resp.error}`);
  if (!resp.signedTransaction) throw new Error("Wallet returned no signed transaction.");
  return broadcast(resp.signedTransaction);
}

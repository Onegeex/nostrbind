// Read/write the BCH chain through a public Fulcrum server (Electrum Cash protocol over WSS).
import { ElectrumClient } from "@electrum-cash/network";
import { FULCRUM_HOSTS } from "./config";
import { scripthash, type PathName, type Utxo, lockingBytecodeToAddress } from "./bch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: ElectrumClient<any> | null = null;
let connecting: Promise<void> | null = null;

async function getClient() {
  if (client) return client;
  if (!connecting) {
    connecting = (async () => {
      let lastError: unknown;
      for (const host of FULCRUM_HOSTS) {
        try {
          const c = new ElectrumClient("NostrBind", "1.4.3", host);
          await c.connect();
          client = c;
          return;
        } catch (e) {
          lastError = e;
        }
      }
      connecting = null;
      throw new Error(`Could not reach a BCH server. ${String(lastError ?? "")}`);
    })();
  }
  await connecting;
  return client!;
}

async function call<T>(method: string, ...params: (string | number | boolean)[]): Promise<T> {
  const c = await getClient();
  const r = await c.request(method, ...params);
  if (r instanceof Error) throw r;
  return r as T;
}

interface RawUnspent {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number;
  token_data?: unknown;
}

export async function listUnspent(
  lockingBytecode: Uint8Array,
  path: PathName,
  index: number,
): Promise<Utxo[]> {
  const sh = await scripthash(lockingBytecode);
  // "include_tokens" makes token UTXOs visible so we can avoid spending them.
  const rows = await call<RawUnspent[]>("blockchain.scripthash.listunspent", sh, "include_tokens");
  const address = lockingBytecodeToAddress(lockingBytecode);
  return rows.map((r) => ({
    txid: r.tx_hash,
    vout: r.tx_pos,
    value: BigInt(r.value),
    lockingBytecode,
    address,
    path,
    index,
    hasToken: r.token_data !== undefined && r.token_data !== null,
  }));
}

export async function getHistory(lockingBytecode: Uint8Array): Promise<{ tx_hash: string; height: number }[]> {
  const sh = await scripthash(lockingBytecode);
  return call("blockchain.scripthash.get_history", sh);
}

export async function getRawTx(txid: string): Promise<string> {
  return call<string>("blockchain.transaction.get", txid, false);
}

export async function broadcast(rawHex: string): Promise<string> {
  return call<string>("blockchain.transaction.broadcast", rawHex);
}

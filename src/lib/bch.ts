// Pure BCH helpers: addresses, OP_RETURN encoding, transaction building and parsing.
// No network access in this file, so it can be unit-tested directly.
import {
  binToHex,
  cashAddressToLockingBytecode,
  decodeAuthenticationInstructions,
  decodeTransaction,
  encodeDataPush,
  encodeLockingBytecodeP2pkh,
  encodeTransaction,
  hash160,
  hexToBin,
  lockingBytecodeToCashAddress,
  utf8ToBin,
  type Transaction,
} from "@bitauth/libauth";
import {
  DUST_LIMIT,
  FEE_RATE,
  OP_RETURN_PREFIX,
  OP_RETURN_VERSION,
} from "./config";

export type PathName = "receive" | "change";

/** A spendable coin we know which HD key controls. */
export interface Utxo {
  txid: string;
  vout: number;
  value: bigint;
  lockingBytecode: Uint8Array;
  address: string;
  path: PathName;
  index: number;
  hasToken: boolean;
}

export const OP_RETURN = 0x6a;

export function pubkeyToAddress(publicKey: Uint8Array): string {
  const bytecode = encodeLockingBytecodeP2pkh(hash160(publicKey));
  return lockingBytecodeToAddress(bytecode);
}

export function lockingBytecodeToAddress(bytecode: Uint8Array): string {
  const r = lockingBytecodeToCashAddress({ bytecode, prefix: "bitcoincash" });
  if (typeof r === "string") throw new Error(r);
  return r.address;
}

export function addressToLockingBytecode(address: string): Uint8Array {
  const withPrefix = address.includes(":") ? address : `bitcoincash:${address}`;
  const r = cashAddressToLockingBytecode(withPrefix);
  if (typeof r === "string") throw new Error(`Invalid BCH address: ${r}`);
  return r.bytecode;
}

export function isValidAddress(address: string): boolean {
  try {
    addressToLockingBytecode(address.trim());
    return true;
  } catch {
    return false;
  }
}

/** Normalise to the canonical "bitcoincash:q..." form. */
export function normaliseAddress(address: string): string {
  return lockingBytecodeToAddress(addressToLockingBytecode(address.trim()));
}

/** Electrum "scripthash": sha256 of the locking bytecode, byte-reversed, hex. */
export async function scripthash(lockingBytecode: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", lockingBytecode as BufferSource),
  );
  return binToHex(digest.reverse());
}

// ---------- OP_RETURN commitment ----------

export function encodeCommitment(nostrPubkeyHex: string): Uint8Array {
  const pubkey = hexToBin(nostrPubkeyHex);
  if (pubkey.length !== 32) throw new Error("Nostr pubkey must be 32 bytes");
  return Uint8Array.from([
    OP_RETURN,
    ...encodeDataPush(utf8ToBin(OP_RETURN_PREFIX)),
    ...encodeDataPush(Uint8Array.of(OP_RETURN_VERSION)),
    ...encodeDataPush(pubkey),
  ]);
}

/** Returns the committed Nostr pubkey (hex) if this output is a NostrBind commitment. */
export function decodeCommitment(lockingBytecode: Uint8Array): string | null {
  if (lockingBytecode[0] !== OP_RETURN) return null;
  const ops = decodeAuthenticationInstructions(lockingBytecode.slice(1));
  // Minimal encoding turns a 1-byte push of 1..16 into OP_1..OP_16 (0x51..0x60),
  // so read those opcodes back as their number.
  const pushes = ops.map((op) => {
    if ("data" in op) return (op as { data: Uint8Array }).data;
    if (op.opcode >= 0x51 && op.opcode <= 0x60) return Uint8Array.of(op.opcode - 0x50);
    return null;
  });
  if (pushes.length !== 3 || pushes.some((p) => p === null)) return null;
  const [prefix, version, pubkey] = pushes as Uint8Array[];
  if (new TextDecoder().decode(prefix) !== OP_RETURN_PREFIX) return null;
  if (version.length !== 1 || version[0] !== OP_RETURN_VERSION) return null;
  if (pubkey.length !== 32) return null;
  return binToHex(pubkey);
}

// ---------- transaction parsing ----------

/**
 * Address that signed a P2PKH input: the unlocking bytecode is <sig> <pubkey>,
 * so the spender's address is hash160(pubkey). Returns null for non-P2PKH inputs.
 */
export function inputSignerAddress(unlockingBytecode: Uint8Array): string | null {
  const ops = decodeAuthenticationInstructions(unlockingBytecode);
  if (ops.length !== 2) return null;
  const last = ops[1] as { data?: Uint8Array };
  const pubkey = last.data;
  if (!pubkey || (pubkey.length !== 33 && pubkey.length !== 65)) return null;
  return pubkeyToAddress(pubkey);
}

export interface ParsedCommitment {
  txid: string;
  nostrPubkey: string;
  signerAddresses: string[];
}

export function parseCommitmentTx(txid: string, rawHex: string): ParsedCommitment | null {
  const tx = decodeTransaction(hexToBin(rawHex));
  if (typeof tx === "string") return null;
  let nostrPubkey: string | null = null;
  for (const out of tx.outputs) {
    const found = decodeCommitment(out.lockingBytecode);
    if (found) {
      nostrPubkey = found;
      break;
    }
  }
  if (!nostrPubkey) return null;
  const signerAddresses = tx.inputs
    .map((i) => inputSignerAddress(i.unlockingBytecode))
    .filter((a): a is string => a !== null);
  return { txid, nostrPubkey, signerAddresses };
}

// ---------- transaction building ----------

export interface UnsignedTx {
  transaction: Transaction;
  sourceOutputs: Array<{
    outpointIndex: number;
    outpointTransactionHash: Uint8Array;
    sequenceNumber: number;
    unlockingBytecode: Uint8Array;
    lockingBytecode: Uint8Array;
    valueSatoshis: bigint;
  }>;
  inputPaths: [number, PathName, number][];
  fee: bigint;
}

// Size estimate for P2PKH inputs (~148 bytes each with a Schnorr/ECDSA sig).
function estimateSize(inputs: number, outputs: Uint8Array[]): number {
  const outBytes = outputs.reduce((s, lb) => s + 8 + 1 + lb.length, 0);
  return 10 + inputs * 148 + outBytes;
}

function buildTx(
  coins: Utxo[],
  payOutputs: { lockingBytecode: Uint8Array; valueSatoshis: bigint }[],
  changeLockingBytecode: Uint8Array,
): UnsignedTx {
  const plain = coins.filter((c) => !c.hasToken);
  const need = payOutputs.reduce((s, o) => s + o.valueSatoshis, 0n);
  // Largest coins first keeps the transaction small.
  const sorted = [...plain].sort((a, b) => (b.value > a.value ? 1 : -1));
  const chosen: Utxo[] = [];
  let total = 0n;
  let fee = 0n;
  for (const c of sorted) {
    chosen.push(c);
    total += c.value;
    fee = BigInt(
      estimateSize(chosen.length, [
        ...payOutputs.map((o) => o.lockingBytecode),
        changeLockingBytecode,
      ]) * FEE_RATE,
    );
    if (total >= need + fee) break;
  }
  if (total < need + fee) {
    const short = Number(need + fee - total) / 1e8;
    throw new Error(`Not enough BCH: short by about ${short.toFixed(8)} BCH.`);
  }
  const outputs = [...payOutputs];
  const change = total - need - fee;
  if (change >= DUST_LIMIT) {
    outputs.push({ lockingBytecode: changeLockingBytecode, valueSatoshis: change });
  } else {
    fee += change; // tiny remainder goes to miners
  }
  const inputs = chosen.map((c) => ({
    outpointIndex: c.vout,
    outpointTransactionHash: hexToBin(c.txid),
    sequenceNumber: 0xffffffff,
    unlockingBytecode: new Uint8Array(),
  }));
  return {
    transaction: { version: 2, inputs, outputs, locktime: 0 },
    sourceOutputs: chosen.map((c, i) => ({
      ...inputs[i],
      lockingBytecode: c.lockingBytecode,
      valueSatoshis: c.value,
    })),
    inputPaths: chosen.map((c, i) => [i, c.path, c.index]),
    fee,
  };
}

/**
 * Commitment tx: spends coins from ONE address (the identity address),
 * writes the OP_RETURN, and returns the change to that same address.
 * Spending from that address is what proves control of it.
 */
export function buildCommitmentTx(identityCoins: Utxo[], nostrPubkeyHex: string): UnsignedTx {
  if (identityCoins.length === 0) throw new Error("The chosen address has no spendable BCH.");
  const address = identityCoins[0].address;
  if (identityCoins.some((c) => c.address !== address))
    throw new Error("Commitment coins must all come from one address.");
  return buildTx(
    identityCoins,
    [{ lockingBytecode: encodeCommitment(nostrPubkeyHex), valueSatoshis: 0n }],
    identityCoins[0].lockingBytecode,
  );
}

export function buildPaymentTx(
  coins: Utxo[],
  toAddress: string,
  sats: bigint,
  changeLockingBytecode: Uint8Array,
): UnsignedTx {
  if (sats < DUST_LIMIT) throw new Error(`Minimum payment is ${DUST_LIMIT} sats.`);
  return buildTx(
    coins,
    [{ lockingBytecode: addressToLockingBytecode(toAddress), valueSatoshis: sats }],
    changeLockingBytecode,
  );
}

/** txid = double-sha256 of the raw transaction, byte-reversed. */
export async function txidOf(rawHex: string): Promise<string> {
  const tx = decodeTransaction(hexToBin(rawHex));
  if (typeof tx === "string") throw new Error(tx);
  const bytes = encodeTransaction(tx) as BufferSource;
  const once = await crypto.subtle.digest("SHA-256", bytes);
  const twice = new Uint8Array(await crypto.subtle.digest("SHA-256", once));
  return binToHex(twice.reverse());
}

export function satsToBch(sats: bigint): string {
  const neg = sats < 0n;
  const v = neg ? -sats : sats;
  const whole = v / 100000000n;
  const frac = (v % 100000000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export function bchToSats(bch: string): bigint {
  const s = bch.trim();
  if (!/^\d*(\.\d{0,8})?$/.test(s) || s === "" || s === ".")
    throw new Error("Enter an amount like 0.001");
  const [w, f = ""] = s.split(".");
  return BigInt(w || "0") * 100000000n + BigInt((f + "00000000").slice(0, 8));
}

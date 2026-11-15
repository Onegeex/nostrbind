import { strict as assert } from "node:assert";
import { binToHex, encodeDataPush, encodeTransaction, hexToBin, decodeTransaction, hash160, encodeLockingBytecodeP2pkh } from "@bitauth/libauth";
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools";
import {
  bchToSats, buildCommitmentTx, buildPaymentTx, decodeCommitment, encodeCommitment,
  normaliseAddress, parseCommitmentTx, pubkeyToAddress, satsToBch, txidOf, type Utxo,
} from "../src/lib/bch";
import { bindingTemplate } from "../src/lib/nostr";

const G = hexToBin("0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798");
const addr = pubkeyToAddress(G);
const lb = encodeLockingBytecodeP2pkh(hash160(G));
const nostrPk = "ab".repeat(32);

// 1. commitment round trip
const c = encodeCommitment(nostrPk);
assert.equal(decodeCommitment(c), nostrPk);
assert.equal(decodeCommitment(hexToBin("6a0401020304")), null);
console.log("commitment round trip ok, bytes:", c.length);

// 2. commitment tx: change returns to identity address, fee sane
const coin = (v: bigint, i: number): Utxo => ({ txid: "11".repeat(31) + i.toString(16).padStart(2, "0"), vout: 0, value: v, lockingBytecode: lb, address: addr, path: "receive", index: 0, hasToken: false });
const u = buildCommitmentTx([coin(10000n, 1)], nostrPk);
assert.equal(u.transaction.outputs.length, 2);
assert.equal(u.transaction.outputs[0].valueSatoshis, 0n);
assert.equal(binToHex(u.transaction.outputs[1].lockingBytecode), binToHex(lb));
assert.equal(u.transaction.outputs[1].valueSatoshis + u.fee, 10000n);
assert.ok(u.fee > 150n && u.fee < 400n, `fee ${u.fee}`);
assert.deepEqual(u.inputPaths, [[0, "receive", 0]]);
console.log("commitment tx ok, fee:", u.fee);

// 3. simulate the wallet signing: unlocking = <sig> <pubkey>; parse finds signer + key
const signed = { ...u.transaction, inputs: u.transaction.inputs.map((i) => ({ ...i, unlockingBytecode: Uint8Array.from([...encodeDataPush(new Uint8Array(65).fill(7)), ...encodeDataPush(G)]) })) };
const raw = binToHex(encodeTransaction(signed));
assert.ok(typeof decodeTransaction(hexToBin(raw)) !== "string");
const parsed = parseCommitmentTx("x", raw)!;
assert.equal(parsed.nostrPubkey, nostrPk);
assert.deepEqual(parsed.signerAddresses, [addr]);
console.log("parse signed commitment ok, signer:", addr);
console.log("txid computed:", (await txidOf(raw)).length === 64);

// 4. a tx with no commitment is rejected
const pay = buildPaymentTx([coin(50000n, 2)], addr, 20000n, lb);
const rawPay = binToHex(encodeTransaction(pay.transaction));
assert.equal(parseCommitmentTx("y", rawPay), null);
assert.equal(pay.transaction.outputs[0].valueSatoshis, 20000n);
console.log("payment tx ok, fee:", pay.fee);

// 5. errors: not enough funds, dust payment, mixed addresses
assert.throws(() => buildPaymentTx([coin(1000n, 3)], addr, 5000n, lb), /Not enough BCH/);
assert.throws(() => buildPaymentTx([coin(100000n, 4)], addr, 100n, lb), /Minimum payment/);
assert.throws(() => buildCommitmentTx([coin(5000n, 5), { ...coin(5000n, 6), address: "bitcoincash:other" }], nostrPk), /one address/);
// token coins are never spent
assert.throws(() => buildPaymentTx([{ ...coin(100000n, 7), hasToken: true }], addr, 1000n, lb), /Not enough BCH/);
console.log("error cases ok");

// 6. amounts
assert.equal(bchToSats("0.0001"), 10000n);
assert.equal(bchToSats("1.5"), 150000000n);
assert.equal(satsToBch(10000n), "0.0001");
assert.throws(() => bchToSats("abc"));
assert.equal(normaliseAddress(addr.replace("bitcoincash:", "")), addr);
console.log("amounts + address ok");

// 7. Nostr binding event is valid and carries the claim
const sk = generateSecretKey();
const ev = finalizeEvent(bindingTemplate(addr, "cd".repeat(32)), sk);
assert.ok(verifyEvent(ev));
assert.equal(ev.pubkey, getPublicKey(sk));
const tag = ev.tags.find((t) => t[0] === "i")!;
assert.equal(tag[1], `bch:${addr}`);
assert.equal(tag[2], "cd".repeat(32));
console.log("nostr binding event ok");
console.log("ALL TESTS PASSED");

// NIP-05 endpoint: GET /.well-known/nostr.json?name=<name>
// Answers only for names held by a fully verified NostrBind passport.
// Bundled to api/nip05.mjs by `npm run build:api`.
import WebSocket from "ws";
import { useWebSocketImplementation } from "nostr-tools/pool";
import { RELAYS } from "../src/lib/config";

// Node's built-in WebSocket loops on failed relay connections; use ws instead.
useWebSocketImplementation(WebSocket);
import { nameError, normaliseName, pickOwner, type Claimant } from "../src/lib/names";
import { fetchNameClaims } from "../src/lib/nostr";
import { verifyPubkey } from "../src/lib/verify";

interface Req { query: Record<string, string | string[] | undefined>; method?: string }
interface Res {
  setHeader(k: string, v: string): void;
  status(code: number): Res;
  json(body: unknown): void;
  end(): void;
}

async function resolve(name: string): Promise<Claimant | null> {
  const claims = await fetchNameClaims(name);
  const pubkeys = [...new Set(claims.map((c) => c.event.pubkey))].slice(0, 10);
  const checked = await Promise.all(
    pubkeys.map(async (pk): Promise<Claimant | null> => {
      try {
        const r = await verifyPubkey(pk);
        return r.verified && r.name === name ? { pubkey: pk, height: r.height ?? 0, createdAt: r.boundAt ?? 0 } : null;
      } catch {
        return null;
      }
    }),
  );
  return pickOwner(checked.filter((c): c is Claimant => c !== null));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);
}

export default async function handler(req: Req, res: Res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const raw = Array.isArray(req.query.name) ? req.query.name[0] : req.query.name;
  const name = normaliseName(raw ?? "");
  if (!name || nameError(name)) {
    res.setHeader("Cache-Control", "public, s-maxage=3600");
    return res.status(200).json({ names: {} });
  }

  const owner = await withTimeout(resolve(name), 9000);
  if (owner === "timeout") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ names: {}, error: "Relays or the BCH server were too slow. Try again." });
  }
  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  return res.status(200).json(
    owner ? { names: { [name]: owner.pubkey }, relays: { [owner.pubkey]: RELAYS } } : { names: {} },
  );
}

import { useMemo } from "react";
import type { Profile } from "../lib/nostr";
import { npubOf } from "../lib/nostr";

// ---------- security-paper guilloche, generated once ----------

function guilloche(color: string): string {
  // Tile is seamless: whole sine cycles across the width, lines stay inside the height.
  const w = 360;
  const h = 64;
  const paths: string[] = [];
  for (let k = 0; k < 6; k++) {
    const amp = 9 + k * 3.4;
    const phase = (k * Math.PI) / 6;
    let d = "";
    for (let x = 0; x <= w; x += 4) {
      const t = (x / w) * Math.PI * 2;
      const y = h / 2 + amp * Math.sin(2 * t + phase) * Math.cos(t - phase);
      d += `${x === 0 ? "M" : "L"}${x} ${y.toFixed(2)}`;
    }
    paths.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="0.6"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${paths.join("")}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const GUILLOCHE = guilloche("#D6D4EF");

// ---------- machine-readable zone ----------

function mrzSafe(s: string): string {
  return s
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "<");
}

function mrzLine(s: string, len = 44): string {
  return (s + "<".repeat(len)).slice(0, len);
}

export function mrz(name: string, npub: string, address?: string): [string, string] {
  const n = mrzSafe(name).replace(/^<+|<+$/g, "") || "UNNAMED";
  // Passport order: surname first, then given names, separated by "<<".
  const parts = n.split("<").filter(Boolean);
  const surname = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  const given = parts.length > 1 ? parts.slice(0, -1).join("<") : "";
  const line1 = mrzLine(`P<NBD${surname}<<${given}`);
  const key = npub.replace(/^npub1/, "").toUpperCase();
  const addr = (address ?? "").replace(/^bitcoincash:/, "").toUpperCase();
  const line2 = mrzLine(`${key.slice(0, 26)}<BCH<${addr.slice(0, 13)}`);
  return [line1, line2];
}

// ---------- stamp ----------

export function Stamp({ kind, date }: { kind: "verified" | "rejected"; date?: string }) {
  const ok = kind === "verified";
  const id = ok ? "stamp-ok" : "stamp-bad";
  return (
    <svg className={`stamp ${ok ? "ok" : "bad"}`} viewBox="0 0 200 200" role="img" aria-label={ok ? "Verified" : "Not verified"}>
      <defs>
        <filter id={`${id}-ink`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={ok ? 3 : 7} />
          <feDisplacementMap in="SourceGraphic" scale="3.2" />
        </filter>
        <path id={`${id}-arc`} d="M 30 100 A 70 70 0 1 1 170 100" />
        <path id={`${id}-arc2`} d="M 34 108 A 66 66 0 0 0 166 108" />
      </defs>
      <g filter={`url(#${id}-ink)`} fill="none" stroke="currentColor">
        <circle cx="100" cy="100" r="92" strokeWidth="5" />
        <circle cx="100" cy="100" r="80" strokeWidth="1.6" />
        <text fill="currentColor" stroke="none" fontSize="15" fontWeight="700" letterSpacing="3">
          <textPath href={`#${id}-arc`} startOffset="50%" textAnchor="middle">
            {ok ? "BITCOIN CASH" : "PROOF FAILED"}
          </textPath>
        </text>
        <text fill="currentColor" stroke="none" fontSize="13" fontWeight="700" letterSpacing="3">
          <textPath href={`#${id}-arc2`} startOffset="50%" textAnchor="middle">
            NOSTRBIND
          </textPath>
        </text>
        <rect x="18" y="80" width="164" height="40" rx="4" fill="var(--sheet)" strokeWidth="4" />
        <text x="100" y="109" textAnchor="middle" fill="currentColor" stroke="none" fontSize={ok ? 27 : 21} fontWeight="800" letterSpacing="1.5">
          {ok ? "VERIFIED" : "NOT VERIFIED"}
        </text>
        {date && (
          <text x="100" y="141" textAnchor="middle" fill="currentColor" stroke="none" fontSize="11" fontWeight="600" letterSpacing="1">
            {date}
          </text>
        )}
      </g>
    </svg>
  );
}

// ---------- passport page ----------

export interface PassportData {
  pubkey: string;
  profile: Profile | null;
  address?: string;
  boundAt?: number;
  verified: boolean;
  checks: { label: string; ok: boolean; detail?: string }[];
  txid?: string;
}

function fmtDate(ts?: number) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function Passport({
  data,
  specimen = false,
  stampKey,
  explorerUrl,
}: {
  data: PassportData;
  specimen?: boolean;
  stampKey?: string;
  explorerUrl?: (txid: string) => string;
}) {
  const npub = useMemo(() => (specimen ? "npub1specimen0000000000000000000000000000000000000000000000000" : npubOf(data.pubkey)), [data.pubkey, specimen]);
  const name = data.profile?.display_name || data.profile?.name || "Unnamed";
  const [l1, l2] = mrz(name, npub, data.address);
  const issued = fmtDate(data.boundAt);

  return (
    <article className={`passport ${specimen ? "is-specimen" : ""}`} style={{ backgroundImage: GUILLOCHE }} aria-label={`NostrBind passport for ${name}`}>
      <header className="passport-band">
        <span className="passport-emblem" aria-hidden="true">
          <svg viewBox="0 0 32 32"><circle cx="12" cy="16" r="8" /><circle cx="20" cy="16" r="8" /></svg>
        </span>
        <span>NostrBind passport</span>
        <span className="passport-type">Nostr ⟷ Bitcoin Cash</span>
      </header>

      <div className="passport-body">
        <div className="passport-photo">
          {data.profile?.picture && !specimen ? (
            <img src={data.profile.picture} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <svg viewBox="0 0 80 100" aria-hidden="true"><circle cx="40" cy="38" r="17" /><path d="M8 100c0-22 14-34 32-34s32 12 32 34" /></svg>
          )}
        </div>

        <dl className="passport-fields">
          <div className="f-name">
            <dt>Name</dt>
            <dd>{name}</dd>
          </div>
          <div>
            <dt>Nostr address</dt>
            <dd>{data.profile?.nip05?.replace(/^_@/, "") || "None set"}</dd>
          </div>
          <div>
            <dt>Date of binding</dt>
            <dd>{issued}</dd>
          </div>
          <div className="f-wide">
            <dt>Nostr key</dt>
            <dd className="mono" title={npub}>{npub.slice(0, 22)}…{npub.slice(-8)}</dd>
          </div>
          <div className="f-wide">
            <dt>Bitcoin Cash address</dt>
            <dd className="mono" title={data.address}>
              {data.address ? `${data.address.replace("bitcoincash:", "").slice(0, 20)}…${data.address.slice(-8)}` : "No binding found"}
            </dd>
          </div>
        </dl>
      </div>

      <section className="endorsements" aria-label="Proof checks">
        <h3>Endorsements</h3>
        <ul>
          {data.checks.map((c, i) => (
            <li key={i} className={c.ok ? "ok" : "bad"}>
              <span className="tick" aria-hidden="true">{c.ok ? "✓" : "✕"}</span>
              <span>
                {c.label}
                {c.detail && <span className="detail"> {c.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
        {data.txid && explorerUrl && (
          <a className="tx-link" href={explorerUrl(data.txid)} target="_blank" rel="noreferrer">
            See the Bitcoin Cash transaction
          </a>
        )}
      </section>

      <div className="mrz" aria-hidden="true">
        <div>{l1}</div>
        <div>{l2}</div>
      </div>

      <div className="stamp-slot" key={stampKey}>
        <Stamp kind={data.verified ? "verified" : "rejected"} date={data.verified ? issued.toUpperCase() : undefined} />
      </div>
      {specimen && <div className="specimen-mark" aria-hidden="true">Specimen</div>}
    </article>
  );
}

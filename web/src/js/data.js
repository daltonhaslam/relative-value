// Lazy loaders for the data files under docs/data/. Everything is same-origin (CSP connect-src 'self').

const cache = new Map();

async function gunzipJson(res) {
  const buf = new Uint8Array(await res.arrayBuffer());
  // A host may already have decoded the file (Content-Encoding: gzip): check the gzip magic bytes.
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(buf));
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open the lookup files. Try a current Chrome, Safari, Edge or Firefox.");
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

export function load(path) {
  if (!cache.has(path)) {
    const p = fetch(`data/${path}`).then((res) => {
      if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status}).`);
      return path.endsWith(".gz") ? gunzipJson(res) : res.json();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path);
}

export const pricingTables = () => Promise.all([load("codes.json"), load("m25.json"), load("rbcs.json")]);

/** ZIP5 -> locality key, using CMS's ZIP-to-carrier-locality file (packed 5-digit runs per locality). */
export async function zipToLocality(zip) {
  if (!/^\d{5}$/.test(zip)) return null;
  const z = await load("zip-locality.json");
  for (const [key, packed] of Object.entries(z.loc)) {
    for (let i = packed.indexOf(zip); i !== -1; i = packed.indexOf(zip, i + 1)) {
      if (i % 5 === 0) return key;
    }
  }
  return null;
}

export async function npiRecord(npi) {
  if (!/^\d{10}$/.test(npi)) return null;
  const [meta, shard] = await Promise.all([load("npi/meta.json"), load(`npi/${npi.slice(-3)}.json.gz`)]);
  const f = meta.recordFields;
  const raw = shard.recs.find((r) => String(r[f.indexOf("npi")]) === npi);
  if (!raw) return null;
  const rec = Object.fromEntries(f.map((k, i) => [k, raw[i]]));
  const lf = meta.lineFields;
  rec.lines = rec.lines.map((l) => {
    const o = Object.fromEntries(lf.map((k, i) => [k, l[i]]));
    return { hcpcs: o.hcpcs, mod: o.mod || "", pos: o.pos === "F" ? "F" : "O", services: Number(o.services), avgAllowed: o.avgAllowed, drug: !!o.drug };
  });
  rec.dataYear = meta.dataYear;
  return rec;
}

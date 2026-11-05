// Name search over docs/data/names/: contiguous range shards of entries sorted by (last, first, npi).
// Mirrors NameIndex in pipeline/npi/test_npi.py.
import { load } from "./data.js";

const norm = (s) => s.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const cmp = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);

function bisectRight(starts, key) {
  let lo = 0, hi = starts.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cmp(key, starts[m]) < 0) hi = m; else lo = m + 1; }
  return lo;
}
function bisectLeft(starts, key) {
  let lo = 0, hi = starts.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cmp(starts[m], key) < 0) lo = m + 1; else hi = m; }
  return lo;
}

let starts = null; // shard start keys, built once from the index
async function shardsFor(last, first) {
  const idx = await load("names/index.json");
  starts ||= idx.files.map((f) => [f[1], f[2]]);
  const lo = [last, first ?? ""];
  const hi = first == null ? [last + "{", ""] : [last, first + "{"];
  const i = Math.max(bisectRight(starts, lo) - 1, 0);
  const j = bisectLeft(starts, hi);
  return idx.files.slice(i, Math.max(j, i + 1)).map((f) => f[0]).slice(0, 6);
}

/** "smith john", "john smith", or a last-name prefix. Returns up to `max` entries. */
export async function searchNames(query, max = 30) {
  const toks = query.split(/[\s,]+/).map(norm).filter(Boolean);
  if (!toks.length) return [];
  const orders = toks.length === 1 ? [[toks[0], null]] : [[toks[0], toks[1]], [toks[1], toks[0]]];
  // Fetch every shard of every order at once, then scan in order so the result cap behaves as before.
  const loaded = await Promise.all(orders.map(async ([last, first]) => {
    const files = await shardsFor(last, first);
    return Promise.all(files.map((f) => load(`names/${f}`)));
  }));
  const hits = new Map();
  for (const [oi, [last, first]] of orders.entries()) {
    for (const entries of loaded[oi]) {
      for (const e of entries) {
        const ok = first == null ? e[0].startsWith(last) : e[0] === last && e[1].startsWith(first);
        if (ok && !hits.has(e[6])) hits.set(e[6], { name: e[2], type: e[3], city: e[4], state: e[5], npi: String(e[6]) });
        if (hits.size >= max) return [...hits.values()];
      }
    }
  }
  return [...hits.values()];
}

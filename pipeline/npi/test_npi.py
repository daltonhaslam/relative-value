"""Checks for the NPI, name, ZIP and RBCS outputs. Run: python -I pipeline/npi/test_npi.py"""
from __future__ import annotations

import bisect
import gzip
import json
import random
import sys
import unittest
from collections import Counter
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402
from build_shards import norm  # noqa: E402


def load_gz(path: Path):
    return json.loads(gzip.decompress(path.read_bytes()))


def all_records():
    for p in sorted(c.NPI_DIR.glob("*.json.gz")):
        yield from load_gz(p)["recs"]


class NameIndex:
    """Reference implementation of the browser-side shard lookup (see README)."""

    def __init__(self):
        idx = json.loads((c.NAMES_DIR / "index.json").read_text())
        self.files = idx["files"]
        self.starts = [(f[1], f[2]) for f in self.files]

    def shards_for(self, last: str, first_prefix: str | None = None) -> list[str]:
        """Shards for last-name prefix `last` (first_prefix None) or exact `last` + first-name prefix.
        '{' sorts right after 'z', so (x + '{') bounds every key starting with x."""
        lo = (last, first_prefix or "")
        hi = (last + "{", "") if first_prefix is None else (last, first_prefix + "{")
        i = max(bisect.bisect_right(self.starts, lo) - 1, 0)
        j = bisect.bisect_left(self.starts, hi)
        return [f[0] for f in self.files[i:max(j, i + 1)]]

    def search(self, query: str) -> list[list]:
        toks = [norm(t) for t in query.split() if norm(t)]
        hits = {}
        orders = [(toks[0], "")] if len(toks) == 1 else [(toks[0], toks[1]), (toks[1], toks[0])]
        for last, first in orders:
            exact_last = len(toks) > 1
            for fn in self.shards_for(last, first if exact_last else None):
                for e in load_gz(c.NAMES_DIR / fn):
                    ok = (e[0] == last and e[1].startswith(first)) if exact_last else e[0].startswith(last)
                    if ok:
                        hits[e[6]] = e
        return list(hits.values())


class TestNPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.con = duckdb.connect()
        cls.con.execute(f"CREATE VIEW ps AS SELECT * FROM '{c.PS_PARQUET}'")
        cls.gpci = c.load_gpci()
        cls.meta = json.loads((c.NPI_DIR / "meta.json").read_text())

    def test_shard_roundtrip(self):
        rng = random.Random(2027)
        npis = [r[0] for r in self.con.execute("SELECT DISTINCT npi FROM ps ORDER BY npi").fetchall()]
        sample = rng.sample(npis, 5) + ["1003000126"]
        for npi in sample:
            recs = {r[0]: r for r in load_gz(c.NPI_DIR / f"{npi[-3:]}.json.gz")["recs"]}
            rec = recs[npi]
            rows = self.con.execute(
                "SELECT first_name, last_name, credentials, provider_type, city, state, zip5, coalesce(loc_key,''),"
                " hcpcs, pos, tot_srvcs, avg_allowed, drug_ind FROM ps WHERE npi = ?", [npi]).fetchall()
            f, l, cr, t, city, st, z, loc = rows[0][:8]
            name = " ".join(x for x in (f, l) if x)
            self.assertEqual(rec[1], f"{name}, {cr}" if cr else name)
            self.assertEqual(rec[2:7], [t, city, st, z, loc])
            want = sorted((h, p, round(s, 1), round(a, 2), d == "Y") for *_, h, p, s, a, d in rows)
            got = sorted((x[0], x[2], float(x[3]), x[4], len(x) == 6 and x[5] == 1) for x in rec[7])
            self.assertEqual(want, got, npi)
            dollars = [x[3] * x[4] for x in rec[7]]
            self.assertEqual(dollars, sorted(dollars, reverse=True))

    def test_counts_and_localities(self):
        n = 0
        locs = Counter()
        mods = Counter()
        for r in all_records():
            n += 1
            locs[r[6]] += 1
            for line in r[7]:
                mods[line[1]] += 1
                self.assertIn(line[2], ("F", "O"))
        self.assertEqual(n, self.meta["records"])
        self.assertEqual(n, self.con.execute("SELECT count(DISTINCT npi) FROM ps").fetchone()[0])
        unknown = {k for k in locs if k and k not in self.gpci}
        self.assertEqual(unknown, set())
        self.assertLess(locs[""], 500)  # foreign / unmatched ZIPs only
        self.assertEqual(set(mods), {"", "26", "TC"})

    def test_mod_guess_sanity(self):
        from modguess import ModGuesser
        g = ModGuesser()
        by = {"rad_f": Counter(), "path_f": Counter(), "ortho_o": Counter()}
        for r in all_records():
            key = {("Diagnostic Radiology", "F"): "rad_f", ("Pathology", "F"): "path_f",
                   ("Orthopedic Surgery", "O"): "ortho_o"}
            for line in r[7]:
                if line[1]:
                    self.assertIn(line[0], g.split)  # mods only on PC/TC-split codes
                k = key.get((r[2], line[2]))
                if k and line[0] in g.split:
                    by[k][line[1]] += 1
        share = lambda cnt, m: cnt[m] / sum(cnt.values())  # noqa: E731
        self.assertGreater(share(by["rad_f"], "26"), 0.95)
        self.assertGreater(share(by["path_f"], "26"), 0.95)
        self.assertGreater(share(by["ortho_o"], ""), 0.6)

    def test_name_index_covers_each_npi_once(self):
        idx = json.loads((c.NAMES_DIR / "index.json").read_text())
        seen = Counter()
        prev_last = None
        for i, (fn, frm_last, frm_first, count) in enumerate(idx["files"]):
            es = load_gz(c.NAMES_DIR / fn)
            self.assertEqual(len(es), count)
            self.assertLessEqual(len(json.dumps(es, separators=(",", ":"))), 600_000)
            keys = [(e[0], e[1], e[6]) for e in es]
            self.assertEqual(keys, sorted(keys))
            if i:
                self.assertGreaterEqual((es[0][0], es[0][1]), (frm_last, frm_first))
                self.assertGreater((es[0][0], es[0][1]), prev_last)
            prev_last = (es[-1][0], es[-1][1])
            seen.update(e[6] for e in es)
        npis = {r[0] for r in self.con.execute("SELECT DISTINCT npi FROM ps").fetchall()}
        self.assertEqual(set(seen), npis)
        self.assertEqual(max(seen.values()), 1)

    def test_name_search_orders(self):
        ni = NameIndex()
        row = self.con.execute("SELECT npi, first_name, last_name FROM ps WHERE npi = '1003000126' LIMIT 1").fetchone()
        npi, first, last = row
        for q in (f"{last} {first}", f"{first} {last}", f"{last}", f"{last[:4]}", f"{last} {first[:2]}"):
            self.assertIn(npi, {e[6] for e in ni.search(q)}, q)
        a, b = ni.search("smith john"), ni.search("john smith")
        self.assertEqual({e[6] for e in a}, {e[6] for e in b})
        self.assertTrue(any(e[0] == "smith" and e[1].startswith("john") for e in a))
        self.assertTrue(all((e[0], e[1][:4]) in {("smith", "john"), ("john", "smit")} for e in a))

    def test_zip_locality(self):
        z = json.loads(c.ZIP_JSON.read_text())
        m = {}
        for k, s in z["loc"].items():
            self.assertIn(k, self.gpci)
            self.assertEqual(len(s) % 5, 0)
            for i in range(0, len(s), 5):
                self.assertNotIn(s[i:i + 5], m)
                m[s[i:i + 5]] = k
        self.assertEqual(set(z["loc"]), set(self.gpci))
        self.assertEqual(m["10001"], "13202-01")   # Manhattan
        self.assertEqual(m["11373"], "13292-04")   # Queens
        self.assertEqual(m["94103"], "01112-05")   # San Francisco
        self.assertEqual(m["60601"], "06102-16")   # Chicago
        self.assertEqual(m["00901"], "09202-20")   # San Juan PR
        self.assertGreater(len(m), 40_000)

    def test_rbcs(self):
        r = json.loads(c.RBCS_JSON.read_text())
        self.assertEqual(r["labels"][r["codes"]["99214"]][0], "E&M")
        self.assertEqual(r["labels"][r["codes"]["71046"]][1], "Standard X-ray")
        self.assertTrue(all(len(x) == 3 for x in r["labels"]))

    def test_budget(self):
        files = [p for d in (c.NPI_DIR, c.NAMES_DIR) for p in d.iterdir()]
        self.assertLessEqual(sum(p.stat().st_size for p in files), 200 * 2**20)
        self.assertLessEqual(len(files), 3000)


if __name__ == "__main__":
    unittest.main(verbosity=2)

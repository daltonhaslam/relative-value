"""Build docs/data/npi/<shard>.json, docs/data/npi/meta.json and docs/data/names/*.json from data/work/ps.parquet.

See pipeline/npi/README.md for formats. Usage: python -I pipeline/npi/build_shards.py [--measure]
"""
from __future__ import annotations

import gzip
import json
import re
import shutil
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402
from modguess import ModGuesser  # noqa: E402

NAME_SHARD_LIMIT = 400_000   # uncompressed bytes per name shard
DUMPS = dict(separators=(",", ":"), ensure_ascii=False)


def norm(s: str) -> str:
    """Lowercase ASCII letters only (accents folded, punctuation/space/digits dropped)."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z]", "", s.lower())


def display_name(first: str, last: str, cred: str) -> str:
    name = " ".join(p for p in (first, last) if p)
    return f"{name}, {cred}" if cred else name


def num1(x: float):
    r = round(x, 1)
    return int(r) if r == int(r) else r


def build_records(con, guesser: ModGuesser):
    """Yield (npi, header dict, lines) per NPI, lines sorted by services*avgAllowed desc."""
    cur = con.execute("""
        SELECT npi, first_name, last_name, credentials, provider_type, city, state, zip5, loc_key,
               hcpcs, drug_ind, pos, tot_srvcs, avg_allowed
        FROM ps ORDER BY npi, tot_srvcs * avg_allowed DESC, hcpcs, pos""")
    cur_npi, head, lines = None, None, []
    while True:
        batch = cur.fetchmany(200_000)
        if not batch:
            break
        for (npi, first, last, cred, ptype, city, state, zip5, loc, hcpcs, drug, pos, srv, allowed) in batch:
            if npi != cur_npi:
                if cur_npi is not None:
                    yield cur_npi, head, lines
                cur_npi, lines = npi, []
                head = dict(first=first, last=last, cred=cred, type=ptype, city=city, state=state,
                            zip5=zip5, loc=loc or "")
            mod = guesser.guess(hcpcs, pos, loc, allowed, ptype)
            lines.append([hcpcs, mod, pos, num1(srv), round(allowed, 2), drug])
    if cur_npi is not None:
        yield cur_npi, head, lines


def name_shards(entries: list) -> list[tuple[list, list]]:
    """Cut the (last, first, npi)-sorted entries into contiguous ranges of <= NAME_SHARD_LIMIT
    uncompressed bytes. A cut is only made where (last, first) changes, so one (last, first) pair
    never spans two shards. Returns [(from_key [last, first], entries)]."""
    out: list[tuple[list, list]] = []
    cur: list = []
    size = 2
    for e in entries:
        b = len(json.dumps(e, **DUMPS).encode()) + 1
        if cur and size + b > NAME_SHARD_LIMIT and (e[0], e[1]) != (cur[-1][0], cur[-1][1]):
            out.append(([cur[0][0], cur[0][1]], cur))
            cur, size = [], 2
        cur.append(e)
        size += b
    if cur:
        out.append(([cur[0][0], cur[0][1]], cur))
    out[0] = (["", ""], out[0][1])  # first range is open below
    return out


def gz(obj) -> bytes:
    return gzip.compress(json.dumps(obj, **DUMPS).encode("utf-8"), compresslevel=9, mtime=0)


def write_gz(path: Path, obj) -> int:
    data = gz(obj)
    path.write_bytes(data)
    return len(data)


def main(measure: bool = False) -> None:
    con = duckdb.connect()
    con.execute(f"CREATE VIEW ps AS SELECT * FROM '{c.PS_PARQUET}'")
    guesser = ModGuesser()
    gpci_keys = set(guesser.gpci)

    shards: dict[str, list] = defaultdict(list)
    names: list = []
    mod_stats = Counter()
    mod_by_type_pos = defaultdict(Counter)
    n_lines = 0
    for npi, h, lines in build_records(con, guesser):
        for l in lines:
            if l[0] in guesser.split:
                mod_stats[l[1]] += 1
                mod_by_type_pos[f"{h['type']}|{l[2]}"][l[1]] += 1
        n_lines += len(lines)
        assert h["loc"] == "" or h["loc"] in gpci_keys
        disp = display_name(h["first"], h["last"], h["cred"])
        out_lines = [l[:5] if l[5] == "N" else l[:5] + [1] for l in lines]
        shards[npi[-3:]].append([npi, disp, h["type"], h["city"], h["state"], h["zip5"], h["loc"], out_lines])
        names.append([norm(h["last"]), norm(h["first"]), disp, h["type"], h["city"], h["state"], npi])

    print(f"NPIs={len(names)} lines={n_lines}")
    print("mod guess (PCTC 1 lines):", dict(mod_stats))
    name_sh = name_shards(sorted(names, key=lambda e: (e[0], e[1], e[6])))
    c.write_json(c.WORK / "npi_stats.json", {
        "mod": dict(mod_stats), "mod_by_type_pos": {t: dict(v) for t, v in mod_by_type_pos.items()}})
    if measure:
        raw = sum(len(json.dumps({"v": 1, "recs": r}, **DUMPS).encode()) for r in shards.values())
        print(f"npi raw bytes={raw:,}; name shards={len(name_sh)}")
        return

    for d in (c.NPI_DIR, c.NAMES_DIR):
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)
    npi_bytes = sum(write_gz(c.NPI_DIR / f"{key}.json.gz", {"v": 1, "recs": recs})
                    for key, recs in sorted(shards.items()))
    c.write_json(c.NPI_DIR / "meta.json", {
        "v": 1,
        "source": "CMS Medicare Physician & Other Practitioners - by Provider and Service",
        "dataYear": c.PS_DATA_YEAR,
        "records": len(names),
        "lines": n_lines,
        "shard": "npi/<last 3 digits of NPI>.json.gz (gzip of JSON {v, recs:[record,...]})",
        "recordFields": ["npi", "name", "providerType", "city", "state", "zip5", "locality", "lines"],
        "lineFields": ["hcpcs", "mod", "pos", "services", "avgAllowed", "drug"],
        "lineNotes": {
            "mod": "guessed for PCTC-indicator-1 codes: '' (global), '26' or 'TC'; always '' otherwise",
            "pos": "F facility, O non-facility (office)",
            "drug": "6th element 1 present only when HCPCS_Drug_Ind = Y; absent otherwise",
            "services": "Tot_Srvcs rounded to 1 decimal (integers written without decimals)",
            "avgAllowed": f"Avg_Mdcr_Alowd_Amt for data year {c.PS_DATA_YEAR}, 2 decimals",
            "sort": "services x avgAllowed descending; all lines kept",
        },
        "locality": "'<MAC>-<locality>' from the provider's practice ZIP5 via CMS ZIP5_OCT2026 (2026Q4); '' if no match",
    })
    files = []
    name_bytes = 0
    for i, (frm, es) in enumerate(name_sh):
        fn = f"{i:03d}.json.gz"
        name_bytes += write_gz(c.NAMES_DIR / fn, es)
        files.append([fn, frm[0], frm[1], len(es)])
    c.write_json(c.NAMES_DIR / "index.json", {
        "v": 1,
        "fields": ["last", "first", "name", "providerType", "city", "state", "npi"],
        "normalize": "NFKD, drop non-ASCII, lowercase, keep a-z only (last and first are stored normalized)",
        "order": "entries sorted by (last, first, npi); shards are contiguous ranges of that order",
        "shards": "[file, fromLast, fromFirst, count]: shard i holds keys >= its from-key and < shard i+1's",
        "files": files,
    })
    print(f"npi shards={len(shards)} gz bytes={npi_bytes:,}; name shards={len(files)} gz bytes={name_bytes:,}")


if __name__ == "__main__":
    main(measure="--measure" in sys.argv)

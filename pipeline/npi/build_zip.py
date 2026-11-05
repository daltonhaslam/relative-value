"""ZIP5 -> payment locality, from CMS's ZIP Code to Carrier Locality file (ZIP5_OCT2026.txt, 2026Q4).

Output docs/data/zip-locality.json:
  {"v":1, "yq":"20264", "loc": {"<MAC>-<LOC>": "<zip5><zip5>...", ...}}
Each value is the concatenation of that locality's 5-digit ZIPs (sorted). The browser expands it
into a Map once (substring every 5 chars). ZIPs whose locality is split by ZIP+4 (Plus Four Flag 1)
carry CMS's ZIP5 default locality.

Also writes data/work/zip5.csv (zip5,loc_key,rural,plus4) for the NPI pipeline.
Usage: python -I pipeline/npi/build_zip.py
"""
from __future__ import annotations

import csv
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402


def parse_zip5(path: Path) -> dict[str, dict]:
    out = {}
    with open(path, encoding="latin-1") as f:
        for line in f:
            line = line.rstrip("\r\n")
            if len(line) < 21:
                continue
            z = line[2:7]
            if not z.isdigit():
                continue
            out[z] = {"state": line[0:2], "key": c.loc_key(line[7:12], line[12:14]),
                      "rural": line[14].strip(), "plus4": line[20], "yq": line[75:80].strip()}
    return out


def main() -> None:
    z5 = parse_zip5(c.ZIP5_TXT)
    gpci = c.load_gpci()
    by_loc: dict[str, list[str]] = defaultdict(list)
    unknown = defaultdict(int)
    for z, r in sorted(z5.items()):
        by_loc[r["key"]].append(z)
        if r["key"] not in gpci:
            unknown[(r["key"], r["state"])] += 1
    yq = sorted({r["yq"] for r in z5.values()})
    obj = {"v": 1, "yq": yq[-1], "loc": {k: "".join(v) for k, v in sorted(by_loc.items())}}
    n = c.write_json(c.ZIP_JSON, obj)
    c.WORK.mkdir(parents=True, exist_ok=True)
    with open(c.WORK / "zip5.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["zip5", "loc_key", "state", "rural", "plus4"])
        for z, r in sorted(z5.items()):
            w.writerow([z, r["key"], r["state"], r["rural"], r["plus4"]])
    print(f"zips={len(z5)} localities={len(by_loc)} yq={yq} bytes={n}")
    missing = sorted(set(gpci) - set(by_loc))
    print("GPCI localities with no ZIP:", missing)
    print("ZIP localities not in GPCI2026:", dict(unknown))


if __name__ == "__main__":
    main()

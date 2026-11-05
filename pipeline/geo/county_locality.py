"""County FIPS -> CY2026 payment locality key, parsed from CMS 26LOCCO.csv.

Counties come from us-atlas counties-albers-10m.json (id = 5-digit FIPS, properties.name).
Rules:
  * State column is blank on continuation rows: carry the last state forward. "HAWAII/GUAM" -> HI.
  * Counties text is split on ',', ';', '/', ' AND '; "CNTY"/"COUNTY" dropped; names compared as
    lowercase letters only ("ST. LUCIE" == "St. Lucie", "PRINCE GEORGE'S" == "Prince George's").
  * A "...  IN VIRGINIA" / "IN MARYLAND" suffix on a ';' segment assigns those names to that state
    (the DC + MD/VA suburbs locality).
  * Independent cities (VA FIPS county part >= 500, Baltimore city 24510, St. Louis city 29510,
    Carson City 32510) are matched as "<name> city"; plain names match counties only.
  * "ALL COUNTIES", "ALL OTHER COUNTIES[ EXCEPT ...]", "ALL COUNTIES, EXCEPT ...", "ALL COUNTY
    EQUIVALENTS" fill every county of the state not explicitly assigned (two passes, order-free).
  * Manual aliases for CMS spellings: DADE -> Miami-Dade; ORAGNGE (sic) -> Orange.
Outputs data/work/county_locality.json and pipeline/geo/unmatched.txt.
Usage: python -I pipeline/geo/county_locality.py
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "npi"))
import common as c  # noqa: E402

ATLAS = HERE / "node_modules" / "us-atlas" / "counties-albers-10m.json"
OUT = c.WORK / "county_locality.json"
UNMATCHED = HERE / "unmatched.txt"

STATE_FIPS = {
    "ALABAMA": "01", "ALASKA": "02", "ARIZONA": "04", "ARKANSAS": "05", "CALIFORNIA": "06",
    "COLORADO": "08", "CONNECTICUT": "09", "DELAWARE": "10", "DISTRICT OF COLUMBIA": "11",
    "FLORIDA": "12", "GEORGIA": "13", "HAWAII": "15", "HAWAII/GUAM": "15", "IDAHO": "16",
    "ILLINOIS": "17", "INDIANA": "18", "IOWA": "19", "KANSAS": "20", "KENTUCKY": "21",
    "LOUISIANA": "22", "MAINE": "23", "MARYLAND": "24", "MASSACHUSETTS": "25", "MICHIGAN": "26",
    "MINNESOTA": "27", "MISSISSIPPI": "28", "MISSOURI": "29", "MONTANA": "30", "NEBRASKA": "31",
    "NEVADA": "32", "NEW HAMPSHIRE": "33", "NEW JERSEY": "34", "NEW MEXICO": "35", "NEW YORK": "36",
    "NORTH CAROLINA": "37", "NORTH DAKOTA": "38", "OHIO": "39", "OKLAHOMA": "40", "OREGON": "41",
    "PENNSYLVANIA": "42", "RHODE ISLAND": "44", "SOUTH CAROLINA": "45", "SOUTH DAKOTA": "46",
    "TENNESSEE": "47", "TEXAS": "48", "UTAH": "49", "VERMONT": "50", "VIRGINIA": "51",
    "WASHINGTON": "53", "WEST VIRGINIA": "54", "WISCONSIN": "55", "WYOMING": "56",
    "PUERTO RICO": "72", "VIRGIN ISLANDS": "78",
}
ALIASES = {"dade": "miamidade", "oragnge": "orange"}
INDEPENDENT_CITY_FIPS = {"24510", "29510", "32510"}


def key(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def is_city(fips: str) -> bool:
    return fips in INDEPENDENT_CITY_FIPS or (fips[:2] == "51" and int(fips[2:]) >= 500)


def load_counties(path: Path = ATLAS) -> dict[str, str]:
    t = json.loads(path.read_text())
    return {g["id"]: g["properties"]["name"] for g in t["objects"]["counties"]["geometries"]}


def parse_locco(path: Path = c.LOCCO26_CSV) -> list[dict]:
    """Rows: {key, state_fips, area, text}."""
    rows, state = [], None
    with open(path, newline="", encoding="latin-1") as f:
        for r in csv.reader(f):
            if len(r) < 5 or not (r[0].strip().isdigit() and len(r[0].strip()) == 5):
                continue
            if r[2].strip():
                state = r[2].strip().upper()
            rows.append({"key": c.loc_key(r[0], r[1]), "state": state,
                         "state_fips": STATE_FIPS[state], "area": " ".join(r[3].split()),
                         "text": " ".join(r[4].split()).upper()})
    return rows


def split_names(text: str, default_state: str) -> tuple[list[tuple[str, str]], bool]:
    """-> ([(state_fips, name_key)], is_rest_of_state). Handles 'IN VIRGINIA' segment suffixes."""
    if text.startswith("ALL "):
        return [], True
    out = []
    for seg in text.split(";"):
        seg = seg.strip()
        st = default_state
        m = re.search(r"\bIN (VIRGINIA|MARYLAND)$", seg)
        if m:
            st = STATE_FIPS[m.group(1)]
            seg = seg[:m.start()]
        for part in re.split(r",|/| AND ", seg):
            part = re.sub(r"\b(CNTY|COUNTY)\b", "", part).strip()
            if not part:
                continue
            if part == "DISTRICT OF COLUMBIA":
                out.append(("11", key("District of Columbia")))
                continue
            k = key(part)
            out.append((st, ALIASES.get(k, k)))
    return out, False


def build() -> tuple[dict[str, str], list[str]]:
    counties = load_counties()
    index: dict[tuple[str, str], str] = {}
    for fips, name in counties.items():
        index[(fips[:2], key(name) + ("city" if is_city(fips) else ""))] = fips
    rows = parse_locco()
    assign: dict[str, str] = {}
    problems: list[str] = []
    rest: dict[str, str] = {}
    for r in rows:
        names, is_rest = split_names(r["text"], r["state_fips"])
        if is_rest:
            prev = rest.setdefault(r["state_fips"], r["key"])
            if prev != r["key"]:
                problems.append(f"two rest-of-state localities for state {r['state_fips']}: {prev} {r['key']}")
            continue
        for st, nk in names:
            fips = index.get((st, nk))
            if not fips:
                problems.append(f"no county for {nk!r} in state {st} (locality {r['key']} {r['area']})")
                continue
            if assign.get(fips, r["key"]) != r["key"]:
                problems.append(f"{fips} {counties[fips]} assigned twice: {assign[fips]} {r['key']}")
            assign[fips] = r["key"]
    for fips in counties:
        if fips not in assign and fips[:2] in rest:
            assign[fips] = rest[fips[:2]]
    for fips, name in sorted(counties.items()):
        if fips not in assign:
            problems.append(f"county {fips} {name} has no locality")
    return assign, problems


def main() -> None:
    assign, problems = build()
    gpci = c.load_gpci()
    bad = sorted({k for k in assign.values() if k not in gpci})
    problems += [f"locality {k} not in GPCI2026" for k in bad]
    unused = sorted(set(gpci) - set(assign.values()))
    c.write_json(OUT, dict(sorted(assign.items())))
    lines = problems or ["(none) every us-atlas county has exactly one CY2026 locality key"]
    lines += ["", "GPCI2026 localities with no county on the map (expected: territories not in the "
              "geoAlbersUsa atlas):"] + [f"  {k} {gpci[k]['state']} {gpci[k]['name']}" for k in unused]
    UNMATCHED.write_text("\n".join(lines) + "\n")
    print(f"counties assigned={len(assign)} localities used={len(set(assign.values()))} problems={len(problems)}")
    print("\n".join(lines))


if __name__ == "__main__":
    main()

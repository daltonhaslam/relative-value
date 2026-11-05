"""Shared paths and small loaders for the NPI and geography pipelines.

Every raw file is treated as untrusted data: it is parsed, never executed.
Run scripts with `python -I` from the repo root (paths are resolved from this file).
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
DOCS_DATA = ROOT / "docs" / "data"

PS_CSV = RAW / "ps2024" / "PHY_R26_P05_V10_D24_Prov_Svc.csv"
PS_DATA_YEAR = 2024
PS_PARQUET = WORK / "ps.parquet"
ZIP5_TXT = RAW / "zipcarrier" / "x" / "ZIP5_OCT2026.txt"
ZIP9_TXT = RAW / "zipcarrier" / "x" / "ZIP9_OCT2026.txt"
RVU26_CSV = RAW / "rvu26d" / "x" / "PPRRVU2026_Oct_nonQPP.csv"
GPCI26_CSV = RAW / "rvu26d" / "x" / "GPCI2026.csv"
LOCCO26_CSV = RAW / "rvu26d" / "x" / "26LOCCO.csv"
GPCI27_CSV = (RAW / "pfs27" / "x" / "cy-2027-pfs-final-rule-addenda"
              / "Addendum E Geographic Practice Cost Indices (GPCIs) CY2027 CMS 1848-F_508.csv")
RBCS_CSV = RAW / "rbcs" / "RBCS_Taxonomy_Final_RY26_20260731.csv"

CF_2026_NONQP = 33.4009  # CY2026 non-QP conversion factor (RVU file CONV FACTOR column)

NPI_DIR = DOCS_DATA / "npi"
NAMES_DIR = DOCS_DATA / "names"
ZIP_JSON = DOCS_DATA / "zip-locality.json"
RBCS_JSON = DOCS_DATA / "rbcs.json"


def loc_key(mac: str, loc: str) -> str:
    """Canonical locality key "<5-digit MAC>-<2-digit locality>"."""
    return f"{mac.strip().zfill(5)}-{loc.strip().zfill(2)}"


def load_gpci(path: Path = GPCI26_CSV) -> dict[str, dict]:
    """Locality key -> {state, name, pw, pe, mp}. Works for GPCI2026.csv and Addendum E 2027."""
    out: dict[str, dict] = {}
    with open(path, newline="", encoding="latin-1") as f:
        for row in csv.reader(f):
            if len(row) < 7:
                continue
            mac, st, loc = row[0].strip(), row[1].strip(), row[2].strip()
            if not (mac.isdigit() and len(mac) == 5 and loc.isdigit()):
                continue
            key = loc_key(mac, loc)
            out[key] = {
                "state": st,
                "name": " ".join(row[3].split()).rstrip("*").strip(),
                "pw": float(row[4]), "pe": float(row[5]), "mp": float(row[6]),
            }
    return out


def load_rvu(path: Path = RVU26_CSV) -> dict[tuple[str, str], dict]:
    """(HCPCS, MOD) -> RVU fields used for pricing. Header block is skipped."""
    out: dict[tuple[str, str], dict] = {}
    with open(path, newline="", encoding="latin-1") as f:
        rows = csv.reader(f)
        for row in rows:
            if row and row[0] == "HCPCS":
                break
        for row in rows:
            if len(row) < 26 or not row[0].strip():
                continue

            def num(x: str) -> float:
                x = x.strip()
                return float(x) if x else 0.0

            out[(row[0].strip(), row[1].strip())] = {
                "status": row[3].strip(),
                "work": num(row[5]), "pe_nf": num(row[6]), "pe_f": num(row[8]),
                "mp": num(row[10]), "pctc": row[13].strip(), "glob": row[14].strip(),
            }
    return out


def write_json(path: Path, obj) -> int:
    """Compact JSON; returns bytes written."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    path.write_bytes(data)
    return len(data)

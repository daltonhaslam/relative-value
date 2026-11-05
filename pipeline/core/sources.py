"""Loaders for the pinned CMS inputs. Every number on the site traces to one of these files.

Raw files live in data/raw/ (gitignored); pipeline/sources.json pins URL + sha256.
"""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
P27 = RAW / "pfs27" / "x"
R26 = RAW / "rvu26d" / "x"

# Conversion factors. CY2026: RVU26D README / CY2026 final rule. CY2027: CMS-1848-F Tables D-B1..B4 (PI p. 1972).
CF = {
    2026: {"nonqp": 33.4009, "qp": 33.5675},
    2027: {"nonqp": 32.6286, "qp": 32.9548},
}
ANES_CF = {
    2026: {"nonqp": 20.4976, "qp": 20.5998},
    2027: {"nonqp": 20.1056, "qp": 20.3068},
}
PAYABLE = {"A", "R", "T"}  # PFS status indicators with RVU-based payment
B1_WORK_UPLIFT = 0.16  # Mod B1/B2 adjusted RVU file footnote: B1 +16% work RVU, B2 +32%
B2_WORK_UPLIFT = 0.32
B1_BASE_CODES = [
    "99202", "99203", "99204", "99205", "99211", "99212", "99213", "99214", "99215",
    "99341", "99342", "99344", "99345", "99347", "99348", "99349", "99350",
]


def _num(s):
    return pd.to_numeric(s, errors="coerce")


def rvu2026() -> pd.DataFrame:
    df = pd.read_csv(R26 / "PPRRVU2026_Oct_nonQPP.csv", skiprows=9, dtype=str)
    out = pd.DataFrame({
        "hcpcs": df["HCPCS"].str.strip(),
        "mod": df["MOD"].fillna("").str.strip(),
        "status": df["CODE"].str.strip(),
        "work": _num(df["RVU"]),
        "pe_nf": _num(df["PE RVU"]),
        "pe_f": _num(df["PE RVU.1"]),
        "mp": _num(df["RVU.1"]),
        "pctc": df["IND"].str.strip(),
        "glob": df["DAYS"].str.strip(),
    })
    return out.dropna(subset=["hcpcs"])


def rvu2027() -> pd.DataFrame:
    f = P27 / "cy-2027-pfs-final-rule-addenda" / "Addendum B Relative Value Units and Related Information CY 2027 CMS 1848-F.xlsx"
    df = pd.read_excel(f, header=1, dtype=str)
    df.columns = ["hcpcs", "mod", "status", "notused", "desc", "work", "pe_nf", "pe_f", "mp", "tot_nf", "tot_f", "glob"]
    df = df[df["status"].notna() & df["hcpcs"].notna()].copy()
    out = pd.DataFrame({
        "hcpcs": df["hcpcs"].str.strip(),
        "mod": df["mod"].fillna("").str.strip(),
        "status": df["status"].str.strip(),
        "work": _num(df["work"]),
        "pe_nf": _num(df["pe_nf"]),  # NaN = non-facility NA (paid at facility PE)
        "pe_f": _num(df["pe_f"]),
        "mp": _num(df["mp"]),
        "glob": df["glob"].fillna("").str.strip(),
        "notused": df["notused"].fillna("").str.strip(),
    })
    return out


def _gpci(path, year):
    df = pd.read_csv(path, skiprows=2, dtype=str, encoding="latin1")
    df = df.iloc[:, :7]
    df.columns = ["mac", "state", "loc", "name", "w", "pe", "mp"]
    df = df[df["mac"].str.strip().str.fullmatch(r"\d{5}", na=False)].copy()
    for c in ["mac", "state", "loc", "name"]:
        df[c] = df[c].str.strip()
    df["key"] = df["mac"] + "-" + df["loc"]
    for c in ["w", "pe", "mp"]:
        df[c] = _num(df[c])
    df["name"] = df["name"].str.replace(r"\*+$", "", regex=True).str.strip()
    return df.rename(columns={c: f"{c}{year % 100}" for c in ["w", "pe", "mp"]})


def gpci2026():
    return _gpci(R26 / "GPCI2026.csv", 2026)


def gpci2027():
    return _gpci(P27 / "cy-2027-pfs-final-rule-addenda" / "Addendum E Geographic Practice Cost Indices (GPCIs) CY2027 CMS 1848-F_508.csv", 2027)


def anes2026():
    df = pd.read_csv(R26 / "ANES2026.csv", dtype=str, encoding="latin1")
    df = df.iloc[:, :5]
    df.columns = ["mac", "loc", "name", "qp", "nonqp"]
    df = df[df["mac"].str.strip().str.fullmatch(r"\d{5}", na=False)].copy()
    df["key"] = df["mac"].str.strip() + "-" + df["loc"].str.strip()
    df["qp"] = _num(df["qp"])
    df["nonqp"] = _num(df["nonqp"])
    return df[["key", "qp", "nonqp"]]


def impact_table():
    f = P27 / "cy-2027-pfs-final-rule-estimated-impact-total-allowed-charges-specialty-updated-11-05-2026" / "CY 2027 PFS Final Rule Estimated Impact on Total Allowed Charges by Specialty_508.txt"
    t = pd.read_csv(f, sep="\t", skiprows=1, encoding="latin1", dtype=str).iloc[:, :7]
    t.columns = ["spec", "setting", "allowed_mil", "work", "pe", "mp", "combined"]
    t = t[t["spec"].notna() & t["setting"].notna()].copy()
    t["spec"] = t["spec"].str.strip()
    t["allowed_mil"] = _num(t["allowed_mil"].str.replace(r"[$,]", "", regex=True))
    for c in ["work", "pe", "mp", "combined"]:
        t[c] = _num(t[c].str.replace("%", "")) / 100
    return t


def utilization():
    f = P27 / "cy-2027-pfs-final-rule-2025-utilization-data-crosswalked-2027" / "CMS-1848-F_2025_Utilization_Data_Crosswalked_to_2027_508.txt"
    u = pd.read_csv(f, sep="\t", dtype=str)
    u = u[u["HCPCS"].notna() & u["FACILITY"].isin(["Y", "N"])].copy()
    u["mod"] = u["MOD"].fillna("").str.strip()
    u["fac"] = u["FACILITY"] == "Y"
    u["services"] = _num(u["UNADJUSTED_ALLOWED_SERVICES"])
    u["units"] = _num(u["FR_ADJUSTED_ALLOWED_MTUS*"])
    u["units_raw"] = _num(u["UNADJUSTED_ALLOWED_MTUS"])
    return u.rename(columns={"SPEC": "spec", "HCPCS": "hcpcs"})[["spec", "hcpcs", "mod", "fac", "services", "units", "units_raw"]]


def practitioner_distribution():
    """Sheet 2: share of practitioners in each %-change bin, by impact specialty."""
    f = P27 / "cy-2027-pfs-final-rule-specialty-impacts-practitioner" / "CMS-1848-F_Spec Impacts by Practitioner FR2027 (2025 claims)_Sheet2_508.txt"
    rows = []
    for line in f.read_text(encoding="latin1").splitlines():
        parts = [p.strip().strip('"').strip() for p in line.split("\t")]
        if len(parts) >= 14 and parts[0].isdigit():
            def f(x, pct=False):
                x = x.replace(",", "").rstrip("%")
                return None if x in ("", "-") else float(x) / (100 if pct else 1)
            rows.append({
                "spec": parts[1],
                "practitioners_k": f(parts[2]),  # thousands; "-" in CMS's file = suppressed/small
                "bins": [f(p, True) for p in parts[3:14]],
            })
    return rows


DIST_BINS = ["< -20%", "-20% to -10%", "-10% to -5%", "-5% to -2%", "-2% to -1%", "-1% to 1%",
             "1% to 2%", "2% to 5%", "5% to 10%", "10% to 20%", ">= 20%"]

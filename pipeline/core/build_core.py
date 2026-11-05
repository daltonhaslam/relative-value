"""Build the browser's pricing tables: codes.json, localities.json, specialties.json.

Run: python3 -E pipeline/core/build_core.py   (writes docs/data/)
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from recompute import priced_utilization  # noqa: E402
from sources import (ANES_CF, B1_BASE_CODES, B1_WORK_UPLIFT, B2_WORK_UPLIFT, CF, DIST_BINS, P27, PAYABLE, ROOT,  # noqa: E402
                     anes2026, gpci2026, gpci2027, impact_table, practitioner_distribution, rvu2026, rvu2027)

OUT = ROOT / "docs" / "data"
LABELS = Path(__file__).parent / "labels.json"


def r2(x):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), 2)


def build_codes():
    a, b = rvu2026(), rvu2027()
    a = a[a["status"].isin(PAYABLE)]
    b = b[b["status"].isin(PAYABLE)]
    m = a.merge(b, on=["hcpcs", "mod"], how="outer", suffixes=("26", "27"))
    labels = json.loads(LABELS.read_text()) if LABELS.exists() else {}
    codes = {}
    for r in m.itertuples(index=False):
        key = r.hcpcs + (f"-{r.mod}" if r.mod else "")
        # Facility NA in 2027 (Addendum B blank) while 2026 carries a value: null 2026 facility PE too, so a
        # facility line on such a code is priced at non-facility PE in both years rather than collapsing in 2027.
        # (Non-facility NA needs no mirror: the 2026 file already sets NF PE = F PE where 2026 is NA.)
        f_na = pd.notna(r.work27) and pd.isna(r.pe_f27)
        codes[key] = [
            r2(r.work26), r2(r.pe_nf26), None if f_na else r2(r.pe_f26), r2(r.mp26),
            r2(r.work27), r2(r.pe_nf27), r2(r.pe_f27), r2(r.mp27),
            (r.glob27 if isinstance(r.glob27, str) and r.glob27 else r.glob26) or "",
        ]
    # 2026 codes deleted for 2027 -> CMS analytic crosswalk destinations (utilization ratios)
    xw_f = P27 / "cy-2027-pfs-final-rule-cy-2026-analytic-crosswalk-cy-2027" / "CMS-1848-F_Analytic Crosswalk from CY 2026 to CY 2027_508.txt"
    xw = pd.read_csv(xw_f, sep="\t", dtype=str).fillna("")
    xw.columns = ["src", "smod", "dst", "dmod", "ratio"]
    for c in ["src", "smod", "dst", "dmod"]:
        xw[c] = xw[c].str.strip()
    # Drop a self row only when the source is still payable in 2027; a self row for a deleted source prices null and is skipped.
    payable27 = {(h, md) for h, md, w, pf in zip(b["hcpcs"], b["mod"], b["work"], b["pe_f"]) if pd.notna(w) or pd.notna(pf)}
    self_row = (xw["src"] == xw["dst"]) & (xw["smod"] == xw["dmod"])
    still27 = np.array([(s, m) in payable27 for s, m in zip(xw["src"], xw["smod"])], dtype=bool)
    xw = xw[~(self_row.to_numpy() & still27)]
    cross = {}
    for r in xw.itertuples(index=False):
        k = r.src + (f"-{r.smod}" if r.smod else "")
        d = r.dst + (f"-{r.dmod}" if r.dmod else "")
        cross.setdefault(k, []).append([d, float(r.ratio)])
    return {
        "fields": ["w26", "peNF26", "peF26", "mp26", "w27", "peNF27", "peF27", "mp27", "global"],
        "note": "null peNF = non-facility NA (paid at facility PE); null peF = facility NA (paid at non-facility PE). null year = not payable that year.",
        "cf": CF, "anesCf": ANES_CF,
        "b1": {"codes": B1_BASE_CODES, "b1": B1_WORK_UPLIFT, "b2": B2_WORK_UPLIFT},
        "codes": codes, "crosswalk": cross, "labels": labels,
    }


def anes_weights():
    """Fit CMS's anesthesia locality CF = national CF x (a*wGPCI + b*peGPCI + c*mpGPCI) on CY2026 values."""
    g = gpci2026().merge(anes2026(), on="key")
    X = g[["w26", "pe26", "mp26"]].to_numpy()
    y = (g["nonqp"] / ANES_CF[2026]["nonqp"]).to_numpy()
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = np.abs(X @ coef * ANES_CF[2026]["nonqp"] - g["nonqp"].to_numpy()).max()
    return coef, float(resid)


def build_localities():
    g = gpci2026().merge(gpci2027()[["key", "w27", "pe27", "mp27"]], on="key", how="outer")
    coef, resid = anes_weights()
    assert resid < 0.011, f"anesthesia locality fit residual {resid}"
    locs = {}
    for r in g.itertuples(index=False):
        locs[r.key] = {
            "state": r.state, "name": r.name.title(),
            "g26": [r.w26, r.pe26, r.mp26], "g27": [r.w27, r.pe27, r.mp27],
        }
    return {"fields": "g = [work, PE, MP] GPCI; 2026 work includes the 1.0 floor, 2027 has none",
            "anesWeights": [round(float(c), 6) for c in coef], "anesFitMaxResidual": round(resid, 4),
            "localities": locs}


def build_specialties():
    t = impact_table()
    m = priced_utilization()
    m = m[m["ok"]].copy()
    m["usd26"] = m["rvus26"] * CF[2026]["nonqp"]
    dist = {d["spec"]: d for d in practitioner_distribution()}
    out = []
    for spec, grp in t.groupby("spec", sort=False):
        if spec == "TOTAL":
            continue
        rows = {r.setting: r for r in grp.itertuples(index=False)}
        tot = rows["TOTAL"]
        sub = m[m["impact_spec"] == spec]
        d = dist.get(spec)
        preset = []
        if d and d["practitioners_k"] and len(sub):
            n = (d["practitioners_k"] or 0) * 1000
            by = sub.groupby(["hcpcs", "mod", "fac"]).agg(services=("services", "sum"), usd=("usd26", "sum")).reset_index()
            by = by.sort_values("usd", ascending=False).head(18)
            for r in by.itertuples(index=False):
                per = r.services / n
                if per >= 0.5:
                    preset.append([r.hcpcs + (f"-{r.mod}" if r.mod else ""), "F" if r.fac else "O", round(per, 1)])
        # CMS's modifier-25 factor (claims-time 20% same-day reduction), averaged per code and setting
        m25 = {}
        if len(sub):
            w = sub.assign(fx=sub["m25"].fillna(1) * sub["disc"])
            agg = w.groupby(["hcpcs", "mod", "fac"])[["fx", "disc"]].sum()
            for (h, md, fac), r in agg.iterrows():
                f = r.fx / r.disc if r.disc else 1
                if f < 0.998:
                    m25[(h + (f"-{md}" if md else "")) + ("|F" if fac else "|O")] = round(float(f), 4)
        # CMS's B1/B2 factor: the share of each visit code CMS expects to carry B1/B2 (replacing G2211)
        b12 = {}
        if len(sub):
            w = sub.assign(bx=sub["b"].fillna(1) * sub["disc"])
            agg = w.groupby(["hcpcs", "mod", "fac"])[["bx", "disc"]].sum()
            for (h, md, fac), r in agg.iterrows():
                f = r.bx / r.disc if r.disc else 1
                if f > 1.0005:
                    b12[(h + (f"-{md}" if md else "")) + ("|F" if fac else "|O")] = round(float(f), 4)
        out.append({
            "name": spec,
            "m25": m25,
            "b12": b12,
            "allowedMil": tot.allowed_mil,
            "cms": {"work": tot.work, "pe": tot.pe, "mp": tot.mp, "combined": tot.combined,
                    "nonFacility": rows["Non-Facility"].combined if "Non-Facility" in rows else None,
                    "facility": rows["Facility"].combined if "Facility" in rows else None},
            "practitionersK": d["practitioners_k"] if d else None,
            "dist": d["bins"] if d else None,
            "preset": preset,
        })
    return {"bins": DIST_BINS, "specialties": out,
            "note": "cms.* = CMS impact table (CY2027 PFS final, updated 11-05-2026), RVU changes only, rounded to whole %. "
                    "dist = CMS practitioner file Sheet 2 (share of practitioners by % change in total RVUs). "
                    "preset = top codes by 2026 allowed dollars, services per practitioner (CMS 2025 utilization / practitioner count)."}


def cms_b12_dollars():
    """Dollars CMS's rate-setting expects modifiers B1/B2 to pay in 2027 (2025 utilization, column I)."""
    m = priced_utilization()
    m = m[m["ok"]]
    withb = (m["fr"] * m["t27"]).sum()
    nob = (m["fr"] / m["b"].fillna(1) * m["t27"]).sum()
    return {"b12Dollars2027": round(float((withb - nob) * CF[2027]["nonqp"])), "shareOfAllowed": round(float(withb / nob - 1), 5),
            "note": "Sum over CMS's 2025 utilization of FR-adjusted units x 2027 RVUs, with vs without the B1/B2 factor, at the non-QP CF"}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (ROOT / "pipeline" / "stats").mkdir(exist_ok=True)
    (ROOT / "pipeline" / "stats" / "cms_b12.json").write_text(json.dumps(cms_b12_dollars(), indent=1))
    for name, fn in [("codes", build_codes), ("localities", build_localities), ("specialties", build_specialties), ("m25", None)]:
        if name == "m25":  # split out: loaded with codes.json, not inlined in the page
            data = {"note": "CMS rate-setting factors by impact specialty, 'code|F/O' -> factor (2025 utilization file): "
                            "factors = modifier-25 (column H), b12 = modifier B1/B2 (column I)",
                    "factors": {sp["name"]: sp.pop("m25") for sp in specs["specialties"]},
                    "b12": {sp["name"]: sp.pop("b12") for sp in specs["specialties"]}}
            (OUT / "specialties.json").write_text(json.dumps(specs, separators=(",", ":"), allow_nan=False))
        else:
            data = fn()
        if name == "specialties":
            specs = data
        (OUT / f"{name}.json").write_text(json.dumps(data, separators=(",", ":"), allow_nan=False))
        print(name, (OUT / f"{name}.json").stat().st_size)


if __name__ == "__main__":
    main()

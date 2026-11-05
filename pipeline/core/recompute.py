"""Specialty RVU-only impact recompute (CMS impact table column G), at national rates.

2026 side: CY2025 utilization (discount-adjusted MTUs) x CY2026 RVUs (RVU26D), plus an estimate of
G2211 add-on dollars (G2211 rows are not in the 2027-crosswalked file because the code is replaced by
modifiers B1/B2). G2211 volume is backed out of CMS's own B1/B2 adjustment factor, assuming B1 (+16% work).
2027 side: FR-adjusted MTUs (which carry CMS's mod-25 and B1/B2 factors) x CY2027 RVUs (Addendum B).
Anesthesia (00100-01999) is excluded, as in CMS's practitioner file; it moves with the anesthesia CF.
"""
import numpy as np
import pandas as pd

from sources import B1_WORK_UPLIFT, P27, rvu2026, rvu2027
from specialties_map import SPEC_TO_IMPACT

UTIL = P27 / "cy-2027-pfs-final-rule-2025-utilization-data-crosswalked-2027" / "CMS-1848-F_2025_Utilization_Data_Crosswalked_to_2027_508.txt"


def _total(df, sfx):
    pe = np.where(df["fac"], df["pe_f" + sfx], df["pe_nf" + sfx].fillna(df["pe_f" + sfx]))
    return df["work" + sfx] + pe + df["mp" + sfx]


def priced_utilization():
    u = pd.read_csv(UTIL, sep="\t", dtype=str)
    u = u[u["FACILITY"].isin(["Y", "N"])].copy()
    num = lambda s: pd.to_numeric(s, errors="coerce")
    u = pd.DataFrame({
        "spec": u["SPEC"], "hcpcs": u["HCPCS"], "mod": u["MOD"].fillna(""), "fac": u["FACILITY"] == "Y",
        "services": num(u["UNADJUSTED_ALLOWED_SERVICES"]),
        "fr": num(u["FR_ADJUSTED_ALLOWED_MTUS*"]),
        "disc": num(u["DISCOUNT_ADJUSTED_ALLOWED_MTUS"]),
        "b": num(u["ADJUSTMENT_FACTOR_B1_B2_FR"]),
        "m25": num(u["ADJUSTMENT_FACTOR_MOD25_FR"]),
    })
    u["disc"] = u["disc"].fillna(u["fr"])
    cols = ["hcpcs", "mod", "work", "pe_nf", "pe_f", "mp"]
    m = u.merge(rvu2026()[cols], on=["hcpcs", "mod"], how="left").merge(
        rvu2027()[cols], on=["hcpcs", "mod"], how="left", suffixes=("26", "27"))
    m["t26"] = _total(m, "26")
    m["t27"] = _total(m, "27")
    m["anes"] = m["hcpcs"].str.fullmatch(r"0[01]\d{3}")
    m["impact_spec"] = m["spec"].map(SPEC_TO_IMPACT).fillna("OTHER")
    # G2211 visits implied by CMS's B1/B2 factor: b - 1 = share * 0.16 * work27 / t27
    share = ((m["b"] - 1) * m["t27"] / (B1_WORK_UPLIFT * m["work27"])).where(m["b"] > 1, 0).fillna(0)
    g = rvu2026().query("hcpcs == 'G2211'").iloc[0]
    g2211_t = np.where(m["fac"], g.work + g.pe_f + g.mp, g.work + g.pe_nf + g.mp)
    m["g2211_rvus26"] = share * m["disc"] * g2211_t
    m["rvus26"] = m["disc"] * m["t26"] + m["g2211_rvus26"]
    m["rvus27"] = m["fr"] * m["t27"]
    m["ok"] = m["t26"].notna() & m["t27"].notna() & ~m["anes"]
    return m


def specialty_rvu_change(m=None):
    m = priced_utilization() if m is None else m
    g = m[m["ok"]].groupby("impact_spec")[["rvus26", "rvus27", "g2211_rvus26"]].sum()
    g["rvu_change"] = g["rvus27"] / g["rvus26"] - 1
    return g


if __name__ == "__main__":
    import sys
    from sources import impact_table
    m = priced_utilization()
    g = specialty_rvu_change(m)
    t = impact_table().query("setting == 'TOTAL'").set_index("spec")
    g = g.join(t[["combined"]])
    g["diff"] = g["rvu_change"] - g["combined"]
    print(g[["rvu_change", "combined", "diff"]].round(3).to_string())
    ok = m[m["ok"]]
    print("national", ok.rvus27.sum() / ok.rvus26.sum() - 1)

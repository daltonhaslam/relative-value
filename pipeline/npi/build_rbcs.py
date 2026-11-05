"""docs/data/rbcs.json: HCPCS -> CMS RBCS labels (category, subcategory, family), public-domain CMS text.

Source: RBCS_Taxonomy_Final_RY26_20260731.csv (data.cms.gov "Restructured BETOS Classification System").
One row per HCPCS with RBCS_Latest_Assignment = 1. Output (labels de-duplicated):
  {"v":1, "source":..., "fields":["category","subcategory","family"],
   "labels":[[cat, subcat, family], ...], "codes":{"<HCPCS>": <index into labels>, ...}}
Usage: python -I pipeline/npi/build_rbcs.py
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402


def main() -> None:
    labels: list[tuple] = []
    idx: dict[tuple, int] = {}
    codes: dict[str, int] = {}
    with open(c.RBCS_CSV, newline="", encoding="latin-1") as f:
        for r in csv.DictReader(f):
            if r["RBCS_Latest_Assignment"].strip() != "1":
                continue
            lab = (r["RBCS_Cat_Desc"].strip(), r["RBCS_Subcat_Desc"].strip(), r["RBCS_Family_Desc"].strip())
            if lab not in idx:
                idx[lab] = len(labels)
                labels.append(lab)
            hc = r["HCPCS_Cd"].strip().upper()
            assert hc not in codes, hc
            codes[hc] = idx[lab]
    n = c.write_json(c.RBCS_JSON, {
        "v": 1,
        "source": "CMS Restructured BETOS Classification System, RBCS_Taxonomy_Final_RY26_20260731.csv (latest assignment)",
        "fields": ["category", "subcategory", "family"],
        "labels": [list(x) for x in labels],
        "codes": dict(sorted(codes.items())),
    })
    print(f"codes={len(codes)} labels={len(labels)} bytes={n}")


if __name__ == "__main__":
    main()

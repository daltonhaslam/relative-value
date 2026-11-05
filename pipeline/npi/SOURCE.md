# Sources: NPI lookup, ZIP localities, RBCS labels

All retrieved 2026-11-05. Raw files live in `data/raw/<source>/` (gitignored) and are parsed as untrusted data, never executed.

## Medicare Physician & Other Practitioners: by Provider and Service (data year 2024)
- Catalog: https://data.cms.gov/data.json, dataset "Medicare Physician & Other Practitioners - by Provider and Service". It is the latest data year listed: temporal 2024-01-01/2024-12-31, modified 2026-05-21. The 2025 data year is not yet published.
- URL: https://data.cms.gov/sites/default/files/2026-05/b5ebab5a-f490-418a-9bce-4b9f31419356/PHY_R26_P05_V10_D24_Prov_Svc.csv
- Local: `data/raw/ps2024/PHY_R26_P05_V10_D24_Prov_Svc.csv`
- Size: 3,250,282,192 bytes; 9,781,673 data rows (9,306,818 individual, Ent_Cd = I)
- sha256: `509dc7ce4cd02d8dd160d50d33ce5d942cd120ea306ff1eb2b6ece4f59cb2c23`
- The "by Provider" file was not needed: names, credentials, type, city, state and ZIP come from this file.
- `HCPCS_Desc` (AMA CPT descriptor text) is dropped at load and appears in no output.

## ZIP Code to Carrier Locality File (2026Q4, "updated 08-13-2026")
- Page: https://www.cms.gov/medicare/payment/fee-schedules (link "Zip Code to Carrier Locality File")
- URL: https://www.cms.gov/files/zip/zip-code-carrier-locality-file-updated-08-13-2026.zip
- Local: `data/raw/zipcarrier/` (zip) and `x/` (extracted: ZIP5_OCT2026.txt, ZIP9_OCT2026.txt, layouts)
- Size: 4,717,355 bytes (zip). sha256 zip `64cd98f5fd6087b9f1732a11749e48883ad26f6416cc1e26cd19af135c5b17b2`; ZIP5_OCT2026.txt `6892be209ade4324745f59febfa1382958126bc6ae84957aabcc0c6c382f4fdb`
- Year/quarter field: 20264 on every row. 42,957 ZIP5s; all 109 CY2026 localities appear; every key exists in GPCI2026.

## Restructured BETOS Classification System (RBCS), RY26
- Catalog: data.cms.gov "Restructured BETOS Classification System", modified 2026-09-28
- URL: https://data.cms.gov/sites/default/files/2026-09/c35bb6b7-501d-4c27-ae29-514386dc8919/RBCS_Taxonomy_Final_RY26_20260731.csv
- Local: `data/raw/rbcs/RBCS_Taxonomy_Final_RY26_20260731.csv`
- Size: 2,440,541 bytes. sha256 `9428e8b937c2a7797a2f84a606316239276ee6c0a5e8064692130b97f35375bd`
- 20,081 rows; 17,174 HCPCS with `RBCS_Latest_Assignment = 1` (one per code).

## Already in the repo (downloaded by the lead)
- CY2026 RVU file, October release (`data/raw/rvu26d/x/`): PPRRVU2026_Oct_nonQPP.csv (mod-guess pricing), GPCI2026.csv (109 localities, work GPCI with 1.0 floor), 26LOCCO.csv (counties per locality).
- CY2027 final rule Addendum E GPCIs (109 localities, same keys as 2026).

## Geography
- npm `us-atlas@3.0.1` (`counties-albers-10m.json`, sha256 `a674dfa31b625e92635f32684a61ae135b05a91507f17f2d5164833237fecf46`): Census cartographic boundary counties, pre-projected with geoAlbersUsa. Plus `topojson-client@3.1.0` and `topojson-simplify@3.0.3`. Installed in `pipeline/geo/` (package-lock.json pins them).

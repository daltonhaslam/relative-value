# Relative Value

**What the CY2027 Medicare physician fee schedule pays for the same work.**
Every specialty's raise or cut, why, and a statement that prices any clinician's own services and locality at 2026 and 2027 rates.

## What the site shows

- **Every specialty, priced in full.** CMS's specialty impact table counts relative-value changes only. The chart adds the conversion factor (−2.31%) and each specialty's average change in geographic indices, including the end of the 1.0 work GPCI floor.
- **Your 2027 statement.** Look up a clinician by name or NPI in CMS's public file, or start from a specialty's typical code mix. The same services are priced at 2026 and 2027 rates, split into conversion-factor, relative-value and geographic effects. Every line can be edited: volumes, place of service, codes, ZIP code, QP status, ACO.
- **The spread** of practitioner-level changes within a specialty, from CMS's practitioner file.
- **A county map** of what one service pays, and how much it changes, in every Medicare payment locality.
- **Why:** the conversion factor build, and the policies that moved relative values (modifier 25, G2211 to B1/B2, the indirect practice cost index, joint replacement, behavioral health, the work floor).
- **The conversion factor since 1992,** against the Medicare Economic Index.

## Build

```
python3 -E pipeline/core/build_core.py          # codes, localities, specialties, CMS factors -> docs/data/
node pipeline/stats/specialty_effects.mjs        # prices every clinician -> pipeline/stats/specialty_effects.json
cd web && npm ci && npm test && npm run build    # -> docs/index.html, vercel.json
python3 -m http.server 8765 -d ../docs &         # then: npm run e2e
```

The clinician lookup and map data (`docs/data/npi`, `docs/data/names`, `docs/data/map`, `docs/data/zip-locality.json`, `docs/data/rbcs.json`) are built by `pipeline/npi` and `pipeline/geo`; see their READMEs. Raw CMS downloads live in `data/raw/` (not committed); `pipeline/sources.json` pins their URLs and SHA-256 hashes.

The page is one static HTML file with inlined CSS and JS, self-hosted fonts (SIL Open Font License) and lazily loaded data files from the same origin. No analytics, no cookies, no third-party requests.

## Checks

- `web/test/pricing.test.mjs`: the pricing code reproduces CMS's "Impact on CY 2027 Payment for Selected Procedures" to the cent, for every code and setting in it.
- `pipeline/core/recompute.py`: a recompute of CMS's specialty table from CMS's own utilization file.
- `pipeline/npi/test_npi.py`, `pipeline/geo/test_geo.py`: shard round-trips, name index coverage, modifier-guess sanity, complete county-to-locality mapping.
- `web/e2e/smoke.mjs`: drives the built page in a browser (lookup, search, editing, ZIP, map, share image, URL state).

## Data and licenses

Public CMS and Federal Register data; BLS CPI-U; Census cartographic boundaries via us-atlas. CPT codes and descriptions are copyright the American Medical Association: the site shows CPT code numbers only, with its own plain-English labels, and never AMA descriptor text.

An independent, personal project. It does not represent the views of the author's employer, CMS or any medical society.

Built by Dalton Haslam, MD, MBA. Built with Claude Code. Code: MIT.

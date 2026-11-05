# Medicare PFS conversion factor history, 1992-2027

Retrieved 2026-11-05. File: `history.csv` (36 rows). Raw downloads: `data/raw/history/<source>/` (gitignored, treated as untrusted; parsed with `python3 -I`, never executed).

## Columns
| column | meaning |
|---|---|
| `cf` | CF in effect Jan 1 of the year, as ultimately applied (retroactive legislation that took effect from Jan 1 is reflected; the as-published rule value is in the note). 2026-2027 = non-QP CF. 1992-1997 = chart series (see below). |
| `cf_qp` | Qualifying-APM CF (2026, 2027 only). |
| `cf_wtd` | Day-weighted average CF for the year. Differs from `cf` only in 2003, 2010, 2015, 2024. **Recommended value for the line** (a Jan-1-only value misstates years where a different CF applied to most of the year). |
| `cf_surgical`, `cf_primary_care`, `cf_other_nonsurgical` | All CFs for 1993-1997. |
| `cf_midyear_note` | Mid-year changes, as-published vs. final values, legislation. |
| `mei_pct` | MEI percent increase for the payment year (not the actual update; see caveats). |
| `cpi_u_annual_avg` | BLS CPI-U, U.S. city average, all items, NSA (CUUR0000SA0), annual average (1982-84=100). Blank for 2026-2027. |

## Chart guidance
- **1992-1997:** one CF per year only in 1992. Use the series in `cf`: 1992 single CF; 1993 nonsurgical (31.25); 1994-1997 primary care. Rationale: BBA 1997 built the 1998 single CF from the 1997 primary-care CF, so primary care is the lineage into the single-CF era (1997 primary 35.7671 -> 1998 36.6873). Surgical CFs were 3-15% higher (e.g., 1997: 40.9603) and other-nonsurgical lower (33.8454). Footnote the split; the break at 1998 is a definition change, not a payment change.
- **Anesthesia** has its own CF throughout and is excluded.
- **2026-2027:** plot non-QP in `cf`; QP in `cf_qp` is a separate (higher) line. 2027 is the finalized, not-yet-effective CF.
- **Real dollars:** deflate with `cpi_u_annual_avg` to a chosen base year. For 2026 the BLS annual average does not exist yet; Jan-Sep 2026 monthly mean is 332.243 (computed from BLS monthly values) if a provisional point is wanted. 2027 has no CPI.

## Sources
- BLS CPI-U, series CUUR0000SA0, public API v1 (no key; 10-year windows, annual average = period M13): https://api.bls.gov/publicAPI/v1/timeseries/data/ . The flat file `download.bls.gov/pub/time.series/cu/cu.data.1.AllItems` returned 403 to curl; API worked. Raw JSON: `data/raw/history/bls/`.
- Federal Register final rules / notices (full text via federalregister.gov API `raw_text_url`; short links `https://www.federalregister.gov/d/<doc number>` in the CSV): 60 FR 63358; 61 FR 59717 (govinfo FR-1996-11-22 also saved); 62 FR 59261; 63 FR 58814; 64 FR 59380; 65 FR 65376; 66 FR 55246; 67 FR 79966; 68 FR 9567; 68 FR 63196; 69 FR 66236; 70 FR 70116; 71 FR 69624; 72 FR 66222; 73 FR 69726; 74 FR 61738; 75 FR 73170; 75 FR 26350 (doc 2010-10814); 76 FR 1670; 76 FR 73026; 77 FR 68892; 78 FR 74230; 79 FR 67548; 80 FR 14853; 80 FR 70886; 81 FR 80170; 82 FR 52976; 83 FR 59452; 84 FR 62568; 85 FR 84472; 86 FR 64996; 87 FR 69404; 88 FR 78818; 89 FR 97710; 90 FR 49266. Raw: `data/raw/history/fr_api/`, `fr_1996/`, `fr_1997/`, `fr_2010_corr/`.
- CMS RVU files (the `CONV FACTOR` column of PPRRVU*.csv is the CF CMS used; the RVU README PDFs do NOT state the CF): RVU13AR, 14B, 15A/15B/15D, 16A/16D, 17A/17D, 18A/18D, 19A/19D, 20A/20D, 21A/21D, 22A/22D, 23A/23D, 24A/24B/24D, 25A/25D, 26D from https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files . Raw: `data/raw/history/cms_rvu/`; RVU26D already in `data/raw/rvu26d/`.
- CMS Transmittal R700 (2010 CF 36.0791): https://www.cms.gov/transmittals/downloads/R700OTN.pdf (`fr_2010_corr/`).
- 1992-1994: House Ways and Means Committee 1998 Green Book, App. E, Table E-2 (cites Federal Register 1996a): https://www.govinfo.gov/content/pkg/CPRT-105WPRT7/html/CPRT-105WPRT7-AppendixE.htm . Raw: `govinfo_green/`.
- MEI: 1992-1995 Green Book Table E-2; 1996-2002 each year's PFS final rule/CF notice; **2003-2027 CMS CY2027 PFS final rule Table A-C1** (telehealth originating-site fee table lists MEI by year; local text `data/raw/pfs27/rule.txt`, FR PI doc 2026-22743). Each 2003-2020 value was cross-checked against that year's own final rule; all matched. 2021 (1.4) is from Table A-C1 only.
- CY2027 CFs: `data/raw/pfs27/rule.txt` lines ~349-366 and ~99935-99968 (Tables D-B1/D-B2); 2026 CFs from 90 FR 49266 and RVU26D CONV FACTOR (33.4009 non-QP, 33.5675 QP). Both anchors you gave were confirmed (2026: 33.4009/33.5675; 2027: 32.6286/32.9548).

## Flags and caveats
1. **1992-1994 are secondary-gov, 2-decimal.** Source is a congressional compendium, not the FR rule. 1992 is 31.00 here; secondary sources say 31.001. To upgrade, pull 56 FR 59502 (1991-11-25), 57 FR 55914 (1992-11-25), 58 FR 63626 (1993-12-02); govinfo FR text begins 1994, so these may need the Library of Congress/HathiTrust scans.
2. **2010 December:** 36.8729 for Jun 1-Dec 31 is primary only for Jun 1-Nov 30 (75 FR 73170). The Dec 2010 extension (P.L. 111-286) is from the AMA CF history (secondary). Impact on `cf_wtd`: ~1 month.
3. **2003:** `cf` is Jan 1 (34.5920) but 36.7856 applied Mar 1-Dec 31; `cf_wtd` 36.4310. Chart `cf_wtd`.
4. **2013 text typo:** 78 FR 74230 preamble says 34.0320; its table and CMS RVU13AR give 34.0230 (used).
5. **Retroactive years (2004, 2006, 2007, 2008, 2011-2014, 2021-2023):** the as-published rule CF differs sharply (e.g., 2012: 24.6712 published vs 34.0376 paid). These are the SGR-patch and CAA-bump years; `cf` is what was actually paid. 2015's published April-December SGR cut (28.2239) never took effect. 2021-2023 and 2024 one-year bumps (3.75%, 3.0%, 2.5%, 1.25%/2.93%) expired; each following year's CF dropped. 2026's +2.50% is the same pattern and expires in the 2027 CF.
6. **`mei_pct` is not the update.** Actual CF changes came from the SGR formula (to 2014), flat 0.5% (2015-2019), 0.0% (2020-2025, MACRA), plus legislative bumps and budget-neutrality adjustments. 2003+ values are post-productivity MEI as CMS reports them; the MEI was rebased in 2004 (2000-based), 2011 (2006-based), 2023 (2017-based, used for MEI reporting, not RVU cost shares). 2027 MEI (2.6%) is an estimate through Q2 2026.
7. **CPI 2025 annual average (321.943)** is the mean of 11 months: BLS did not publish October 2025 (lapse in appropriations). 1998-2006 values are published to one decimal; 2007+ to three.
8. **No 2026 mid-year CF change found** as of RVU26D (Oct 2026 file). Re-check if Congress acts before Jan 1, 2027.
9. Retired: the 2008 RVU files and earlier exist at cms.gov, but were not needed because each year's FR rule gave the CF.

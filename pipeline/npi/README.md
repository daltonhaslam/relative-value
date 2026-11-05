# NPI lookup, name search, ZIP localities, RBCS labels

Python 3.11 venv at `data/work/venv` (gitignored) with `duckdb` only:

```sh
/opt/homebrew/bin/python3.11 -m venv data/work/venv && data/work/venv/bin/pip install duckdb
PY="data/work/venv/bin/python -I"
$PY pipeline/npi/build_zip.py      # docs/data/zip-locality.json, data/work/zip5.csv
$PY pipeline/npi/build_ps.py       # data/work/ps.parquet  (~7 s)
$PY pipeline/npi/build_shards.py   # docs/data/npi/*, docs/data/names/*  (~80 s)
$PY pipeline/npi/build_rbcs.py     # docs/data/rbcs.json
$PY pipeline/npi/test_npi.py
```
Sources, hashes and dates are in `SOURCE.md`. Data year **2024** (the latest CMS has published).

## `data/work/ps.parquet` (intermediate, for headline stats)
One row per individual clinician (Ent_Cd = I) × HCPCS × place of service. 9,306,818 rows; 1,147,484 NPIs; (npi, hcpcs, pos) is unique. Each NPI has exactly one name/ZIP/type.

| column | type | from |
|---|---|---|
| npi | VARCHAR(10) | Rndrng_NPI |
| last_name, first_name, mi, credentials | VARCHAR | Rndrng_Prvdr_Last_Org_Name, _First_Name, _MI, _Crdntls (trimmed; '' if null) |
| city, state, zip5 | VARCHAR | Rndrng_Prvdr_City, _State_Abrvtn, _Zip5 (zero-padded) |
| ruca, country | VARCHAR | Rndrng_Prvdr_RUCA, _Cntry |
| provider_type | VARCHAR | Rndrng_Prvdr_Type (CMS specialty string as in the file) |
| participating | VARCHAR | Rndrng_Prvdr_Mdcr_Prtcptg_Ind (Y/N) |
| loc_key | VARCHAR, nullable | "<MAC>-<LOC>" via zip5 → CMS ZIP5 file; NULL for 337 NPIs (2,433 rows): foreign or unmatched ZIPs |
| hcpcs | VARCHAR | HCPCS_Cd (upper) |
| drug_ind | VARCHAR | HCPCS_Drug_Ind (Y/N) |
| pos | VARCHAR | Place_Of_Srvc: F facility, O non-facility |
| tot_benes | INTEGER | Tot_Benes |
| tot_srvcs, tot_bene_day_srvcs | DOUBLE | Tot_Srvcs, Tot_Bene_Day_Srvcs |
| avg_sbmtd_chrg, avg_allowed, avg_pymt, avg_stdzd | DOUBLE | Avg_Sbmtd_Chrg, Avg_Mdcr_Alowd_Amt, Avg_Mdcr_Pymt_Amt, Avg_Mdcr_Stdzd_Amt |

The modifier guess is not stored in the parquet. It lives in the shards; `modguess.ModGuesser` recomputes it.
Street address and HCPCS_Desc (AMA text) are dropped.

## `docs/data/zip-locality.json` (216 KB)
`{"v":1, "yq":"20264", "loc": {"10112-00": "350043500535006...", ...}}`: each value is that locality's 5-digit ZIPs concatenated in sorted order. Expand once in the browser: `for (const [k, s] of Object.entries(loc)) for (let i = 0; i < s.length; i += 5) map.set(s.slice(i, i + 5), k)`.
580 ZIPs straddle localities by ZIP+4 (Plus Four Flag 1). They carry CMS's ZIP5 default, as do the NPIs in them. Territories are present (PR 09202-20, VI 09202-50; GU, AS and MP fall in 01212-01 Hawaii/Guam).

## NPI shards: `docs/data/npi/<ddd>.json.gz` + `meta.json`
**The shards are gzipped JSON** (see Budget below). Decompress in the browser:
```js
const res = await fetch(`data/npi/${npi.slice(-3)}.json.gz`);
const buf = new Uint8Array(await res.arrayBuffer());
// If a host ever serves these with Content-Encoding: gzip, fetch has already inflated them; check the magic bytes.
const text = buf[0] === 0x1f && buf[1] === 0x8b
  ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
  : new TextDecoder().decode(buf);
const { recs } = JSON.parse(text);   // recs: record[]
```
- Shard key: the last 3 digits of the NPI, giving 1,000 files of about 110 KB gz each (≤ 399 KB inflated).
- Record: `[npi, name, providerType, city, state, zip5, locality, lines]`.
  - `name` is "First Last, CRED" (CRED as in the file, e.g. "M.D."; omitted if blank).
  - `locality` is "" for the 337 NPIs with no ZIP match.
- Line: `[hcpcs, mod, pos, services, avgAllowed]`, with a 6th element `1` only when HCPCS_Drug_Ind = Y.
  - `services` is rounded to 1 decimal, written as an integer when whole.
  - `avgAllowed` is the 2024 average allowed, 2 decimals.
  - Lines are sorted by services × avgAllowed, descending. **All lines are kept.**
- `meta.json` holds the data year, the record count (1,147,484), the line count (9,306,818) and the field order.

## Name index: `docs/data/names/NNN.json.gz` + `index.json`
- Entry: `[last, first, name, providerType, city, state, npi]`.
  - `last` and `first` are normalized: NFKD, non-ASCII dropped, lowercase, a–z only. JS: `s.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z]/g, "")`.
  - `name` is the display name, as in the shards.
- All entries are sorted by (last, first, npi). The list is cut into 272 contiguous ranges of ≤ ~400 KB inflated (max 401 KB, about 4,200 entries each).
  - A cut never splits one (last, first) pair.
  - This replaces the fixed-length prefix scheme: range shards keep every file near the size cap with no tiny leaf files. 2-letter and 3-letter prefixes produced 3,157 files.
- `index.json` `files`: `[file, fromLast, fromFirst, count]`. Shard *i* holds keys ≥ its from-key and < shard *i+1*'s.
- Each NPI appears exactly once.
- Lookup (reference implementation: `NameIndex` in `test_npi.py`). Compare keys as tuples; `"{"` sorts right after `"z"`.
  - **Last-name prefix `L`** (one token, e.g. "smi"): fetch shards overlapping `[(L,""), (L+"{",""))`, keep `last.startsWith(L)`.
  - **Two tokens `a b`**: try (last = a, first prefix b) and (last = b, first prefix a). Fetch shards overlapping `[(a,b), (a,b+"{"))` (and the swap), then keep `last === a && first.startsWith(b)`. This serves both "smith john" and "john smith".
  - Hyphenated or compound surnames normalize to one token ("Smith-Jones" → "smithjones"). A search for "jones" will not find them; a substring search would need a full scan.

## Modifier guess (`modguess.py`)
The PS file has no modifiers. For codes with PCTC indicator 1, each line is priced as global, -26 and -TC (1,120 codes that have both -26 and -TC rows).
- Pricing: 2026 Oct non-QP RVUs × GPCI2026 (work floor 1.0) × CF 33.4009 at the provider's locality (national 1.0 if none). Facility PE for F, non-facility PE for O.
- The pick minimizes |ln(avgAllowed / price)|.
- **The average allowed is first divided by the statutory payment share for the practitioner type:** 0.85 for NP, PA, CNS and registered dietitian; 0.75 for LCSW, LPC and MFT.
  - The data confirm these shares. Median office E/M allowed ÷ 2026 price is 0.93 for physicians, 0.79 (≈ 0.85 × 0.93) for NP/PA/CNS and 0.67 (≈ 0.75 × 0.93) for LCSW/LPC/MFT.
  - Without this, NPs' and PAs' office X-rays were misread as -TC.
- Result over 2,066,000 PCTC-1 lines: -26 63.6%, global 28.1%, -TC 8.3%.
  - Facility POS: Diagnostic Radiology 99.6% -26, Pathology 98.1%, Cardiology 99.7%, Interventional Radiology 98.9%.
  - Office POS: Orthopedics 79% global, Ophthalmology 90% global, Diagnostic Radiology 43% global / 38% -26 / 19% -TC.
  - After the guess, median allowed ÷ chosen price is 0.97–1.00 in every (mod, POS) cell.
- Blended lines (e.g., a provider billing both global and -26 under one HCPCS/POS) get the single nearest variant.

## Budget
Plain JSON came to 352 MB (npi) + 109 MB (names), against a ~200 MB / ~3,000-file budget. The fix is the least lossy one: **gzip each shard (level 9, deterministic mtime 0) and decompress with `DecompressionStream`**. That keeps the planned schema and every line.
- Result: **npi 110.9 MB + names 28.1 MB = 139 MB (≈135 MiB) in 1,274 files** (1,000 + meta, 272 + index).
- Fallback if gzip is ever unacceptable: the lossy options were measured.
  - Folding lines past the top 40 per NPI saves ~4% of lines and only 0.22% of dollars.
  - Dropping avgAllowed on priced lines saves ~45 MB.
  - Together they still leave ~300 MB of plain JSON, so gzip is the only route under 200 MB without dropping people or most lines.

## Pricing notes for the browser
- `mod` is "" for every non-split code. On PCTC-1 codes, "" means global.
- **Statutory share:** NP, PA, CNS and dietitian are paid 85% of the fee schedule; LCSW, LPC and MFT 75%. The 2024 `avgAllowed` already reflects this. Apply the share to dollar amounts for those types; percentage changes are unaffected.
- **Anesthesia (status J) lines:** `services` counts cases (services per beneficiary ≈ 1), not base + time units. `avgAllowed` is per case. Use avgAllowed × CF27/CF26 for the locality.
- **Line mix by RVU status in the 2026 file** (share of 2024 allowed dollars):
  - A 75.6%, R 0.27%, T ~0.
  - Drugs (drug flag) 18.1%.
  - X (labs and other non-PFS) 1.7%.
  - C (carrier-priced) 1.6%.
  - **No 2026 RVU row: 1.5%.** These are codes deleted or replaced since 2024, e.g. 37225, 55700, 77401, 99442. They need an "unpriced: code changed" treatment.
  - J (anesthesia) 0.9%; E 0.2%.
- **Locality** comes from the clinician's **practice ZIP in the 2024 file**. It approximates where services were furnished; multi-site clinicians bill in several localities.

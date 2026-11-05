# County map + county → locality

```sh
(cd pipeline/geo && npm ci --ignore-scripts)                       # us-atlas, topojson-client, topojson-simplify
data/work/venv/bin/python -I pipeline/geo/county_locality.py       # data/work/county_locality.json, unmatched.txt
node pipeline/geo/build_map.mjs data/work/county_locality.json docs/data/map/counties.json
data/work/venv/bin/python -I pipeline/geo/test_geo.py
```

## `docs/data/map/counties.json` (675 KB, 194 KB gz)
- **Projection:** pre-projected TopoJSON. It starts from us-atlas `counties-albers-10m.json`, which us-atlas projects with `d3.geoAlbersUsa().scale(1300).translate([487.5, 305])`.
  - Draw it in a `viewBox="0 0 975 610"` with `d3.geoPath()` (null projection) or plain path strings. The browser needs no projection code.
- **Simplification:** planar, minWeight 1 px², re-quantized to 1e4.
  - The geometry objects (arc references, ids, properties) are about 60% of the bytes, so more simplification saves little.
- **Objects:**
  - `counties`: 3,142 (50 states + DC). `id` is the 5-digit FIPS; `properties` are `{n: county name, l: locality key}`.
  - `nation`: the outline.
  - `statesMesh`: interior state borders.
  - `localityMesh`: interior borders between counties in different localities.
  - Both meshes are MultiLineString arc references from `meshArcs`. Use `topojson.feature(topo, topo.objects.statesMesh)`.
- **Not on the map:** Puerto Rico (09202-20) and the U.S. Virgin Islands (09202-50). geoAlbersUsa has no territories; they stay reachable by ZIP.
  - Guam is priced in 01212-01 (Hawaii/Guam) and is not drawn.

## County → locality (`county_locality.py`, rules in its docstring)
- **Result:** all 3,142 counties get exactly one CY2026 key, and `unmatched.txt` is empty.
  - 107 of the 109 GPCI2026 localities have at least one county. The other two are PR and VI, which are territories only.
- **Handled cases:**
  - blank state cells carry forward;
  - "ALL COUNTIES", "ALL OTHER COUNTIES [EXCEPT …]", "ALL COUNTIES, EXCEPT …" and "ALL COUNTY EQUIVALENTS" fill whatever remains in the state;
  - "… IN VIRGINIA" / "IN MARYLAND" segments go to the DC + MD/VA suburbs locality;
  - independent cities are matched by FIPS (VA 5xx+, Baltimore city 24510, St. Louis city 29510). This separates Baltimore city from Baltimore County and Fairfax city from Fairfax County;
  - NYC boroughs map by county name (New York, Kings, Queens, Bronx, Richmond);
  - CMS spellings are aliased: DADE → Miami-Dade, ORAGNGE → Orange.
- **County vintage:** us-atlas 3.0.1 uses pre-2022 Connecticut counties and Valdez-Cordova (AK). Both states are statewide localities, so this does not matter.

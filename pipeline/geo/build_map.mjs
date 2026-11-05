// Build docs/data/map/counties.json: us-atlas counties-albers-10m (already projected with
// d3.geoAlbersUsa().scale(1300).translate([487.5, 305]) into a 975x610 viewBox), simplified for a
// ~960 px national map, each county carrying its CY2026 payment locality key.
// Usage: node build_map.mjs <county_locality.json> <out.json> [minWeight]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { presimplify, simplify } from "topojson-simplify";
import { meshArcs, quantize } from "topojson-client";

const [, , mappingPath, outPath, minWeightArg] = process.argv;
if (!mappingPath || !outPath) throw new Error("usage: node build_map.mjs <county_locality.json> <out.json> [minWeight]");
const minWeight = Number(minWeightArg ?? 1);
const atlasUrl = new URL("./node_modules/us-atlas/counties-albers-10m.json", import.meta.url);
const atlas = JSON.parse(readFileSync(atlasUrl, "utf8"));
const mapping = JSON.parse(readFileSync(mappingPath, "utf8"));

let missing = 0;
for (const g of atlas.objects.counties.geometries) {
  const l = mapping[g.id];
  if (!l) missing++;
  g.properties = { n: g.properties.name, l };
}
if (missing) throw new Error(`${missing} counties have no locality key`);

let topo = simplify(presimplify(atlas), minWeight);
// presimplify un-quantizes; drop the per-point weights it added, then re-quantize (1e4 grid on a
// 975 px wide map is ~0.1 px, invisible at 960 px).
topo.arcs = topo.arcs.map((arc) => arc.map((p) => [p[0], p[1]]));
topo = quantize(topo, 1e4);
// Border meshes as TopoJSON MultiLineString geometries (arc references, no coordinates duplicated).
topo.objects.statesMesh = meshArcs(topo, topo.objects.states, (a, b) => a !== b);
topo.objects.localityMesh = meshArcs(topo, topo.objects.counties, (a, b) => a !== b && a.properties.l !== b.properties.l);
delete topo.objects.states; // only its border mesh is drawn; saves ~60 KB
topo.meta = {
  projection: "d3.geoAlbersUsa().scale(1300).translate([487.5, 305]) (pre-projected by us-atlas 3.0.1)",
  viewBox: [0, 0, 975, 610],
  simplify: `topojson-simplify planar minWeight ${minWeight} (px^2), quantized 1e4`,
  countyProps: { n: "county name (us-atlas)", l: "CY2026 locality key <MAC>-<LOC> from 26LOCCO.csv" },
  objects: "counties (3142, 50 states + DC; props n, l), nation (outline), statesMesh (interior state borders), localityMesh (interior borders between different localities)",
  notIncluded: "Puerto Rico (09202-20) and the U.S. Virgin Islands (09202-50): geoAlbersUsa has no territories",
};
mkdirSync(dirname(outPath), { recursive: true });
const text = JSON.stringify(topo);
writeFileSync(outPath, text);
console.log(`counties=${topo.objects.counties.geometries.length} bytes=${text.length} minWeight=${minWeight}`);

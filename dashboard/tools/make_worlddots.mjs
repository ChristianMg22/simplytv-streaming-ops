// Genera dashboard/src/worlddots.json: matriz de puntos de tierra (Natural Earth 110m vía world-atlas).
// Uso: npm i world-atlas@2 topojson-client d3-geo && node make_worlddots.mjs <salida.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { geoContains } from 'd3-geo';
const topo = JSON.parse(readFileSync('node_modules/world-atlas/land-110m.json', 'utf8'));
const land = feature(topo, topo.objects.land);
const LON0 = -130, LON1 = 65, LAT0 = -40, LAT1 = 74, STEP = 1.6;
const rows = [];
for (let lat = LAT1; lat >= LAT0; lat -= STEP) {
  let s = '';
  for (let lon = LON0; lon <= LON1; lon += STEP) s += geoContains(land, [lon, lat]) ? '1' : '0';
  rows.push(s);
}
writeFileSync(process.argv[2], JSON.stringify({ lon0: LON0, lon1: LON1, lat0: LAT0, lat1: LAT1, step: STEP, rows }));
console.log(rows.length, 'x', rows[0].length, rows.join('').split('1').length - 1, 'puntos');

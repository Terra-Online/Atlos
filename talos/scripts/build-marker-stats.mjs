import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEffectiveMarkers } from './marker-data.mjs';
import { deduplicateMarkersByPositionAndType } from '../src/data/marker/deduplication.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const regionPath = path.join(root, 'src/data/map/region.json');
const typePath = path.join(root, 'src/data/marker/type.json');
const outputPath = path.join(root, 'src/data/marker/stats.json');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const increment = (target, key) => {
  target[key] = (target[key] || 0) + 1;
};

const stats = {
  world: {},
  subregion: {},
  region: {},
};

const regions = readJson(regionPath);
const typeMap = readJson(typePath);
const subregionIds = new Set(Object.values(regions).flatMap((region) => region.subregions ?? []));
const effectiveMarkers = await loadEffectiveMarkers({ typeMap, subregionIds });
const dataSubregionIds = fs
  .readdirSync(path.join(root, 'src/data/marker/data'))
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => file.replace(/\.json$/, ''));
const subregionOrder = [
  ...dataSubregionIds,
  ...[...subregionIds].filter((subregionId) => !dataSubregionIds.includes(subregionId)),
];
const markersBySubregion = new Map(subregionOrder.map((subregionId) => [subregionId, []]));
for (const marker of deduplicateMarkersByPositionAndType(effectiveMarkers)) {
  const list = markersBySubregion.get(marker.subregId) ?? [];
  list.push(marker);
  markersBySubregion.set(marker.subregId, list);
}

for (const [subregionId, markers] of markersBySubregion) {
  const subregionCounts = {};

  for (const marker of markers) {
    const type = marker?.type || '';
    if (!type) continue;
    increment(stats.world, type);
    increment(subregionCounts, type);
  }

  stats.subregion[subregionId] = subregionCounts;
}

for (const [regionKey, regionConfig] of Object.entries(regions)) {
  const regionCounts = {};
  const subregions = Array.isArray(regionConfig?.subregions)
    ? regionConfig.subregions
    : [];

  for (const subregionId of subregions) {
    const subregionCounts = stats.subregion[subregionId] || {};
    for (const [type, count] of Object.entries(subregionCounts)) {
      regionCounts[type] = (regionCounts[type] || 0) + count;
    }
  }

  stats.region[regionKey] = regionCounts;
}

fs.writeFileSync(outputPath, `${JSON.stringify(stats, null, 2)}\n`);
console.log(`[marker-stats] wrote ${path.relative(root, outputPath)}`);

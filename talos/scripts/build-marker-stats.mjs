import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'src/data/marker/data');
const regionPath = path.join(root, 'src/data/map/region.json');
const outputPath = path.join(root, 'src/data/marker/stats.json');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const normalizeRawMarker = (raw) => {
  if (Array.isArray(raw)) {
    return {
      id: raw[0],
      type: raw[4],
    };
  }
  return raw;
};

const increment = (target, key) => {
  target[key] = (target[key] || 0) + 1;
};

const stats = {
  world: {},
  subregion: {},
  region: {},
};

const files = fs
  .readdirSync(dataDir)
  .filter((file) => file.endsWith('.json'))
  .sort();

for (const file of files) {
  const subregionId = file.replace(/\.json$/, '');
  const markers = readJson(path.join(dataDir, file));
  const subregionCounts = {};

  for (const rawMarker of markers) {
    const marker = normalizeRawMarker(rawMarker);
    const type = marker?.type || '';
    if (!type) continue;
    increment(stats.world, type);
    increment(subregionCounts, type);
  }

  stats.subregion[subregionId] = subregionCounts;
}

const regions = readJson(regionPath);
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

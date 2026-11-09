import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCompressedTileCoverage,
  collectClipFiles,
} from './tile-index.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const regionConfigPath = path.resolve(rootDir, 'src/data/map/region.json');
const checkOnly = process.argv.includes('--check');

const regionConfig = await fs.readJson(regionConfigPath);
const configuredRegions = Object.keys(regionConfig).sort((a, b) => a.localeCompare(b));

for (const source of ['clips', 'satellite']) {
  const tilesDir = path.resolve(rootDir, 'public', source);
  const fileName = source === 'clips' ? 'tileCoverage.json' : 'satelliteCoverage.json';
  const outputPath = path.resolve(rootDir, 'src/data/map', fileName);
  if (!(await fs.pathExists(tilesDir))) {
    const snapshot = await fs.readJson(outputPath);
    const snapshotRegions = Object.keys(snapshot.regions ?? {}).sort((a, b) => a.localeCompare(b));
    if (snapshotRegions.some((region) => !configuredRegions.includes(region))
      || (source === 'clips' && JSON.stringify(snapshotRegions) !== JSON.stringify(configuredRegions))) {
      throw new Error(`${source} coverage snapshot does not match configured map regions.`);
    }
    console.log(`[tile-coverage] source ${source} unavailable; using committed snapshot.`);
    continue;
  }

  const files = await collectClipFiles(tilesDir);
  const allCoverage = buildCompressedTileCoverage(files);
  const regions = configuredRegions.filter((region) => allCoverage[region]);
  if (source === 'clips' && regions.length !== configuredRegions.length) {
    throw new Error(`Missing tile coverage for configured regions: ${configuredRegions.filter((region) => !allCoverage[region]).join(', ')}`);
  }
  const payload = { version: 1, regions: Object.fromEntries(regions.map((region) => [region, allCoverage[region]])) };
  const serialized = `${JSON.stringify(payload)}\n`;
  if (checkOnly) {
    if (await fs.readFile(outputPath, 'utf8') !== serialized) {
      throw new Error(`${source} coverage snapshot is stale. Run pnpm data tile-coverage.`);
    }
    console.log(`[tile-coverage] ${source} snapshot is current (${files.length} files scanned).`);
  } else {
    await fs.outputFile(outputPath, serialized);
    console.log(`[tile-coverage] wrote ${fileName} from ${files.length} ${source} files.`);
  }
}

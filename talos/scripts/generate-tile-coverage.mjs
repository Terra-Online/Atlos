import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCompressedTileCoverage,
  collectClipFiles,
} from './tile-index.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clipsDir = path.resolve(rootDir, 'public/clips');
const regionConfigPath = path.resolve(rootDir, 'src/data/map/region.json');
const outputPath = path.resolve(rootDir, 'src/data/map/tileCoverage.json');
const checkOnly = process.argv.includes('--check');

const regionConfig = await fs.readJson(regionConfigPath);
const configuredRegions = Object.keys(regionConfig).sort((a, b) => a.localeCompare(b));

if (!(await fs.pathExists(clipsDir))) {
  const snapshot = await fs.readJson(outputPath);
  const snapshotRegions = Object.keys(snapshot.regions ?? {}).sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(snapshotRegions) !== JSON.stringify(configuredRegions)) {
    throw new Error('Tile coverage snapshot does not match configured map regions.');
  }
  console.log('[tile-coverage] source clips unavailable; using committed snapshot.');
  process.exit(0);
}

const clipFiles = await collectClipFiles(clipsDir);
const allCoverage = buildCompressedTileCoverage(clipFiles);
const missingRegions = configuredRegions.filter((region) => !allCoverage[region]);
if (missingRegions.length > 0) {
  throw new Error(`Missing tile coverage for configured regions: ${missingRegions.join(', ')}`);
}

const payload = {
  version: 1,
  regions: Object.fromEntries(
    configuredRegions.map((region) => [region, allCoverage[region]]),
  ),
};
const serialized = `${JSON.stringify(payload)}\n`;

if (checkOnly) {
  const current = await fs.readFile(outputPath, 'utf8');
  if (current !== serialized) {
    throw new Error('Tile coverage snapshot is stale. Run pnpm run build:tile-coverage.');
  }
  console.log(`[tile-coverage] snapshot is current (${clipFiles.length} files scanned).`);
} else {
  await fs.outputFile(outputPath, serialized);
  console.log(`[tile-coverage] wrote ${path.relative(rootDir, outputPath)} from ${clipFiles.length} files.`);
}

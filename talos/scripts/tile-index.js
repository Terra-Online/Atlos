import fs from 'fs-extra';
import path from 'node:path';

const TILE_FILE_RE = /^(\d+)_(\d+)(_[a-z0-9]+)?\.webp$/i;

const normalizePath = (input) => input.replace(/\\/g, '/');

const walkFiles = async (dir, baseDir, collector) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(fullPath, baseDir, collector);
      continue;
    }
    collector.push(normalizePath(path.relative(baseDir, fullPath)));
  }
};

const toRanges = (values) => {
  if (values.length === 0) return [];
  const uniqueSorted = [...new Set(values)].sort((a, b) => a - b);

  const ranges = [];
  let start = uniqueSorted[0];
  let prev = uniqueSorted[0];

  for (let i = 1; i < uniqueSorted.length; i += 1) {
    const current = uniqueSorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(start, prev);
    start = current;
    prev = current;
  }

  ranges.push(start, prev);
  return ranges;
};

const compressRegionCoverage = (regionCoverage) => {
  const compressedZooms = {};

  Object.keys(regionCoverage)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((zoom) => {
      const layers = regionCoverage[zoom];
      const compressedLayers = {};

      Object.keys(layers)
        .sort((a, b) => {
          if (a === '') return -1;
          if (b === '') return 1;
          return a.localeCompare(b);
        })
        .forEach((suffix) => {
          const rows = layers[suffix];
          const compressedRows = {};
          Object.keys(rows)
            .sort((a, b) => Number(a) - Number(b))
            .forEach((y) => {
              compressedRows[y] = toRanges(rows[y]);
            });
          compressedLayers[suffix] = compressedRows;
        });

      compressedZooms[zoom] = compressedLayers;
    });

  return compressedZooms;
};

const collectTileData = (clipFiles) => {
  const regionCoverage = {};

  clipFiles.forEach((filePath) => {
    const parts = filePath.split('/');
    if (parts.length !== 3) return;

    const [region, zoom, fileName] = parts;
    if (!/^\d+$/.test(zoom)) return;

    const match = fileName.match(TILE_FILE_RE);
    if (!match) return;

    const x = Number(match[1]);
    const y = Number(match[2]);
    const suffix = match[3] ?? '';

    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const zoomCoverage = (regionCoverage[region] ??= {});
    const layerCoverage = (zoomCoverage[zoom] ??= {});
    const rowCoverage = (layerCoverage[suffix] ??= {});
    const row = (rowCoverage[String(y)] ??= []);
    row.push(x);
  });

  return regionCoverage;
};

export const buildClipIndex = async ({ distDir = './dist' } = {}) => {
  const resolvedDist = path.resolve(distDir);
  const clipsDir = path.resolve(resolvedDist, 'clips');

  if (!(await fs.pathExists(clipsDir))) {
    return {
      generated: false,
      reason: 'clips directory does not exist',
      expectedClipFiles: [],
      tileFiles: [],
      indexFiles: [],
    };
  }

  const rawClipFiles = [];
  await walkFiles(clipsDir, clipsDir, rawClipFiles);

  const clipFiles = rawClipFiles
    .filter((relativePath) => !relativePath.startsWith('_index/'))
    .sort((a, b) => a.localeCompare(b));

  const regionCoverageRaw = collectTileData(clipFiles);
  const regions = Object.keys(regionCoverageRaw).sort((a, b) => a.localeCompare(b));

  const indexDir = path.resolve(clipsDir, '_index');
  const coverageDir = path.resolve(indexDir, 'coverage');
  await fs.emptyDir(indexDir);
  await fs.ensureDir(coverageDir);

  const generatedAt = new Date().toISOString();
  const coverageFiles = [];

  for (const region of regions) {
    const payload = {
      version: 1,
      generatedAt,
      region,
      zooms: compressRegionCoverage(regionCoverageRaw[region]),
    };

    const regionFile = path.resolve(coverageDir, `${region}.v1.json`);
    await fs.writeJson(regionFile, payload);
    coverageFiles.push(`_index/coverage/${region}.v1.json`);
  }

  const manifestRelativePath = '_index/manifest.v1.json';
  const manifestPath = path.resolve(clipsDir, manifestRelativePath);
  const manifest = {
    version: 1,
    generatedAt,
    clipFileCount: clipFiles.length,
    regions,
    tileFiles: clipFiles,
    coverageFiles,
  };
  await fs.writeJson(manifestPath, manifest);

  const indexFiles = [manifestRelativePath, ...coverageFiles].sort((a, b) => a.localeCompare(b));
  const expectedClipFiles = [...clipFiles, ...indexFiles]
    .map((relativePath) => `clips/${relativePath}`)
    .sort((a, b) => a.localeCompare(b));

  return {
    generated: true,
    generatedAt,
    regions,
    tileFileCount: clipFiles.length,
    coverageFileCount: coverageFiles.length,
    expectedClipFiles,
    tileFiles: clipFiles,
    indexFiles,
    manifestRelativePath: `clips/${manifestRelativePath}`,
  };
};

export const normalizeObjectKey = (input) => normalizePath(input).replace(/^\/+/, '');

export const toPrefixedObjectKey = (prefix, relativePath) => {
  const cleanPrefix = normalizeObjectKey(prefix).replace(/\/+$/, '');
  const cleanRelativePath = normalizeObjectKey(relativePath);
  return cleanPrefix ? `${cleanPrefix}/${cleanRelativePath}` : cleanRelativePath;
};
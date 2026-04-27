import { getTileResourceUrl } from './resource';

export interface RegionTileCoverage {
  version: number;
  generatedAt: string;
  region: string;
  zooms: Record<string, Record<string, Record<string, number[]>>>;
}

const regionCoveragePromises = new Map<string, Promise<RegionTileCoverage | null>>();

const fetchRegionTileCoverage = async (regionId: string): Promise<RegionTileCoverage | null> => {
  const url = getTileResourceUrl(`/clips/_index/coverage/${regionId}.v1.json`);

  try {
    const response = await fetch(url, { method: 'GET', cache: 'force-cache' });
    if (!response.ok) return null;
    return (await response.json()) as RegionTileCoverage;
  } catch {
    return null;
  }
};

export const getRegionTileCoverage = async (regionId: string): Promise<RegionTileCoverage | null> => {
  if (!regionCoveragePromises.has(regionId)) {
    regionCoveragePromises.set(regionId, fetchRegionTileCoverage(regionId));
  }

  const promise = regionCoveragePromises.get(regionId);
  return promise ?? null;
};

const isXInRanges = (x: number, ranges: number[]) => {
  let left = 0;
  let right = Math.floor(ranges.length / 2) - 1;

  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    const start = ranges[middle * 2];
    const end = ranges[middle * 2 + 1];

    if (x < start) {
      right = middle - 1;
      continue;
    }

    if (x > end) {
      left = middle + 1;
      continue;
    }

    return true;
  }

  return false;
};

export const hasTileInCoverage = (
  coverage: RegionTileCoverage | null,
  zoom: number,
  x: number,
  y: number,
  suffix: string,
): boolean => {
  if (!coverage) return true;

  const zoomData = coverage.zooms[String(zoom)];
  if (!zoomData) return false;

  const layerData = zoomData[suffix];
  if (!layerData) return false;

  const rowRanges = layerData[String(y)];
  if (!rowRanges || rowRanges.length === 0) return false;

  return isXInRanges(x, rowRanges);
};
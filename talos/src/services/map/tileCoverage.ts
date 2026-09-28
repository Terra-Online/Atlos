import tileCoverageData from '@/data/map/tileCoverage.json';

export type ZoomTileCoverage = Record<string, Record<string, number[]>>;

export interface RegionTileCoverage {
    zooms: Record<string, ZoomTileCoverage>;
}

interface TileCoverageData {
    version: number;
    regions: Record<string, Record<string, ZoomTileCoverage>>;
}

const coverageData = tileCoverageData as TileCoverageData;

export const getRegionTileCoverage = (regionId: string): RegionTileCoverage => {
    const zooms = coverageData.regions[regionId];
    if (!zooms) {
        throw new Error(`Tile coverage not found for region: ${regionId}`);
    }
    return { zooms };
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
        } else if (x > end) {
            left = middle + 1;
        } else {
            return true;
        }
    }

    return false;
};

export const hasTileInCoverage = (
    coverage: RegionTileCoverage,
    zoom: number,
    x: number,
    y: number,
    suffix: string,
): boolean => {
    const rowRanges = coverage.zooms[String(zoom)]?.[suffix]?.[String(y)];
    return Boolean(rowRanges?.length && isXInRanges(x, rowRanges));
};

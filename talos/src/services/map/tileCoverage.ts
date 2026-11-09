import tileCoverageData from '@/data/map/tileCoverage.json';
import satelliteCoverageData from '@/data/map/satelliteCoverage.json';
import type { TileSource } from '@/services/assets/resource';
import { getTileLayers } from '@/data/map/tiles';

export { getMaxTileZoom } from '@/data/map/tiles';

export type ZoomTileCoverage = Record<string, Record<string, number[]>>;

export interface RegionTileCoverage {
    zooms: Record<string, ZoomTileCoverage>;
}

interface TileCoverageData {
    version: number;
    regions: Record<string, Record<string, ZoomTileCoverage>>;
}

const coverageData: Record<TileSource, TileCoverageData> = {
    clips: tileCoverageData as TileCoverageData,
    satellite: satelliteCoverageData as TileCoverageData,
};

export const getRegionTileCoverage = (regionId: string, source: TileSource = 'clips'): RegionTileCoverage => {
    const zooms = coverageData[source].regions[regionId];
    if (!zooms) {
        throw new Error(`Tile coverage not found for region: ${regionId}`);
    }
    return { zooms };
};

const availableLayers = Object.fromEntries(Object.entries(coverageData.clips.regions)
    .map(([regionId, zooms]) => [regionId, getTileLayers({ zooms })]));
const baseLayers = getTileLayers({ zooms: {} });

/** Floor availability always follows standard imagery, including in satellite mode. */
export const getAvailableLayers = (regionId: string) => availableLayers[regionId] ?? baseLayers;

export const hasSatelliteTiles = (regionId: string): boolean =>
    Object.values(coverageData.satellite.regions[regionId] ?? {}).some((zoom) =>
        Object.values(zoom[''] ?? {}).some((ranges) => ranges.length > 0),
    );

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

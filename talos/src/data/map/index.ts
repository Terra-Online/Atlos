import REGION_JSON from './region.json';

import VL_SUBREGIONS from './subregionData/VL.json';
import WL_SUBREGIONS from './subregionData/WL.json';

export interface IMapRegion {
    /** Coordinate basis for pixel-space labels, links and subregions. */
    coordZoom: number;
    /** Initial map coordinates, independent of the pixel-space coordinate basis. */
    initialCenter: {
        lat: number;
        lng: number;
    };
    initialZoom: number;
    subregions: string[];
}

export interface IMapSubregionAreaData {
    id: string;
    name: string;
    bounds?: number[][];
    polygon?: number[][][];
}

export const REGION_DICT = REGION_JSON as Record<string, IMapRegion>;

export const SUBREGION_DICT = [...VL_SUBREGIONS, ...WL_SUBREGIONS].reduce(
    (acc, subregion) => {
        acc[subregion.id] = subregion;
        return acc;
    },
    {} as Record<string, IMapSubregionAreaData>,
);

export const DEFAULT_REGION = 'Valley_4';

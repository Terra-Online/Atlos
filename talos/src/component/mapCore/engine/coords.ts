/**
 * Coordinate transforms between the game's flat pixel space and MapLibre's
 * Web Mercator world.
 *
 * Public game coordinate semantics intentionally match Leaflet CRS.Simple so
 * that persisted view states and all marker/label/boundary data stay valid:
 *
 *   project([px, py], zoom)  → lat = -py / 2^zoom, lng = px / 2^zoom   (inverse: unproject)
 *
 * Internally each region is embedded into the mercator world with a fixed
 * tile-pyramid shift:
 *
 *   TILE_ZOOM_OFFSET K: game tile zoom z is served as mercator tile zoom z+K,
 *   so tile indexes are scaled by 2^K. A per-region integer tile offset
 *   (offsetTilesX/Y = n·2^z at zoom z) keeps every tile index inside the
 *   valid mercator range [0, 2^(z+K)).
 *
 *   u = px / (tileSize · 2^(maxZoom+K)) + offsetTilesX / 2^K
 *   v = py / (tileSize · 2^(maxZoom+K)) + offsetTilesY / 2^K
 *   lng = u · 360 - 180
 *   lat = mercatorLat(v)
 *
 * Zoom mapping (keeps 1 game px == 1 screen px at game maxZoom):
 *   mapLibreZoom = gameZoom + K + log2(tileSize / 512)
 */

import type { IMapRegion } from '@/data/map';

/**
 * Game tile pyramid is embedded this many zoom levels deep into mercator.
 * 5 (not 4): leaves the region small enough inside the world that a
 * minimum-zoom viewport stays clear of the world edge, which MapLibre
 * otherwise clamps the camera against (renderWorldCopies: false).
 */
export const TILE_ZOOM_OFFSET = 5;

const TILE_ZOOM_OFFSET_TILES = 1 << TILE_ZOOM_OFFSET; // 2^K
const MAX_MERCATOR_LATITUDE = 85.051129;

export interface RegionTransform {
    readonly maxZoom: number;
    readonly tileSize: number;
    /** Integer tile offset n: mercator tile index = game index + n·2^z. */
    readonly offsetTilesX: number;
    readonly offsetTilesY: number;
    /** log2(tileSize/512) + TILE_ZOOM_OFFSET: gameZoom → mapLibreZoom shift. */
    readonly zoomShift: number;
}

/**
 * Tile offset n (mercator index = game index + n·2^zoom) that CENTERS the
 * region inside the mercator world at maxZoom. Centering keeps a minimum-zoom
 * viewport away from the world edge — MapLibre clamps the camera against the
 * world bounds when renderWorldCopies is false, which would pin the region to
 * the west/north edge at low zoom. Throws if the region cannot fit.
 */
const computeTileOffset = (
    minPx: number,
    maxPx: number,
    tileSize: number,
    maxZoom: number,
): number => {
    const tilesPerAxisAtMax = 1 << (maxZoom + TILE_ZOOM_OFFSET);
    const minIndexAtMax = Math.floor(minPx / tileSize);
    const maxIndexAtMax = Math.floor((maxPx - 1e-6) / tileSize);
    const tileCount = maxIndexAtMax - minIndexAtMax + 1;
    if (tileCount > tilesPerAxisAtMax) {
        throw new Error(
            `Region pixel range [${minPx}, ${maxPx}] needs ${tileCount} tiles but mercator provides ${tilesPerAxisAtMax} at zoom ${maxZoom + TILE_ZOOM_OFFSET}.`,
        );
    }

    // The centering shift is computed in maxZoom index units; convert to n
    // units (shift at zoom z is n·2^z). Rounding off-centers by < 2^(maxZoom-1)
    // tiles — fine, the goal is only clearing the world edge.
    let offset = Math.round(
        (Math.floor((tilesPerAxisAtMax - tileCount) / 2) - minIndexAtMax) /
            (1 << maxZoom),
    );

    // Validate every game zoom (tile indexes shrink by 2^(z-maxZoom)) and
    // nudge the offset up if a lower zoom's negative indexes overflow.
    for (let zoom = 0; zoom <= maxZoom; zoom++) {
        const tilesPerAxis = 1 << (zoom + TILE_ZOOM_OFFSET);
        const tileSpan = tileSize * (1 << (maxZoom - zoom));
        const minIndex = Math.floor(minPx / tileSpan);
        const maxIndex = Math.floor((maxPx - 1e-6) / tileSpan);
        const shift = offset * (1 << zoom);
        if (minIndex + shift < 0) {
            offset += Math.ceil((-minIndex - shift) / (1 << zoom));
        }
        if (maxIndex + offset * (1 << zoom) > tilesPerAxis - 1) {
            throw new Error(
                `Region pixel range [${minPx}, ${maxPx}] overflows mercator tile space at zoom ${zoom}.`,
            );
        }
    }
    return offset;
};

export const createRegionTransform = (config: IMapRegion): RegionTransform => {
    const { maxZoom, tileSize } = config;
    if (maxZoom === undefined || tileSize === undefined) {
        throw new Error(
            `Region config missing maxZoom/tileSize: ${JSON.stringify(config)}`,
        );
    }
    const offsetX = config.boundsOffset?.x ?? 0;
    const offsetY = config.boundsOffset?.y ?? 0;
    const minPxX = offsetX;
    const maxPxX = offsetX + config.dimensions[0];
    const minPxY = offsetY;
    const maxPxY = offsetY + config.dimensions[1];

    return {
        maxZoom,
        tileSize,
        offsetTilesX: computeTileOffset(minPxX, maxPxX, tileSize, maxZoom),
        offsetTilesY: computeTileOffset(minPxY, maxPxY, tileSize, maxZoom),
        zoomShift: TILE_ZOOM_OFFSET + Math.log2(tileSize / 512),
    };
};

/** Game CRS.Simple project: px at native maxZoom → {lat, lng}. */
export const unprojectPx = (
    px: number,
    py: number,
    maxZoom: number,
): { lat: number; lng: number } => ({
    lat: -py / 2 ** maxZoom,
    lng: px / 2 ** maxZoom,
});

/** Game CRS.Simple unproject: {lat, lng} → px at native maxZoom. */
export const projectPx = (
    lat: number,
    lng: number,
    maxZoom: number,
): [number, number] => [lng * 2 ** maxZoom, -lat * 2 ** maxZoom];

const mercatorLat = (v: number): number => {
    const lat =
        ((2 * Math.atan(Math.exp(Math.PI * (1 - 2 * v))) - Math.PI / 2) *
            180) /
        Math.PI;
    // Clamp to mercator-valid range; v beyond [0,1] extrapolates past the poles.
    return Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, lat));
};

const mercatorV = (lat: number): number => {
    const clamped = Math.max(
        -MAX_MERCATOR_LATITUDE,
        Math.min(MAX_MERCATOR_LATITUDE, lat),
    );
    const sin = Math.sin((clamped * Math.PI) / 180);
    return 0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI;
};

/** Game px (native maxZoom space) → mercator normalized u/v. */
export const pxToMercator = (
    transform: RegionTransform,
    px: number,
    py: number,
): { u: number; v: number } => {
    const worldPx =
        transform.tileSize * 2 ** (transform.maxZoom + TILE_ZOOM_OFFSET);
    return {
        u: px / worldPx + transform.offsetTilesX / TILE_ZOOM_OFFSET_TILES,
        v: py / worldPx + transform.offsetTilesY / TILE_ZOOM_OFFSET_TILES,
    };
};

export const mercatorToPx = (
    transform: RegionTransform,
    u: number,
    v: number,
): [number, number] => {
    const worldPx =
        transform.tileSize * 2 ** (transform.maxZoom + TILE_ZOOM_OFFSET);
    return [
        (u - transform.offsetTilesX / TILE_ZOOM_OFFSET_TILES) * worldPx,
        (v - transform.offsetTilesY / TILE_ZOOM_OFFSET_TILES) * worldPx,
    ];
};

/** Game px → MapLibre lngLat. */
export const pxToLngLat = (
    transform: RegionTransform,
    px: number,
    py: number,
): { lng: number; lat: number } => {
    const { u, v } = pxToMercator(transform, px, py);
    return { lng: u * 360 - 180, lat: mercatorLat(v) };
};

/** MapLibre lngLat → game px (native maxZoom space). */
export const lngLatToPx = (
    transform: RegionTransform,
    lng: number,
    lat: number,
): [number, number] => {
    const u = (lng + 180) / 360;
    const v = mercatorV(lat);
    return mercatorToPx(transform, u, v);
};

/** Game lat/lng (CRS.Simple semantics) → MapLibre lngLat. */
export const gameToLngLat = (
    transform: RegionTransform,
    lat: number,
    lng: number,
): { lng: number; lat: number } => {
    const [px, py] = projectPx(lat, lng, transform.maxZoom);
    return pxToLngLat(transform, px, py);
};

/** MapLibre lngLat → game lat/lng (CRS.Simple semantics). */
export const lngLatToGame = (
    transform: RegionTransform,
    lng: number,
    lat: number,
): { lat: number; lng: number } => {
    const [px, py] = lngLatToPx(transform, lng, lat);
    return unprojectPx(px, py, transform.maxZoom);
};

/** Game zoom → MapLibre zoom. */
export const zoomToMapLibre = (
    transform: RegionTransform,
    zoom: number,
): number => zoom + transform.zoomShift;

/** MapLibre zoom → game zoom. */
export const zoomFromMapLibre = (
    transform: RegionTransform,
    zoom: number,
): number => zoom - transform.zoomShift;

/**
 * Region pixel bounds → MapLibre [west, south, east, north] bounds for
 * sources / maxBounds.
 */
export const pxBoundsToLngLatBounds = (
    transform: RegionTransform,
    minPxX: number,
    minPxY: number,
    maxPxX: number,
    maxPxY: number,
): [number, number, number, number] => {
    const northWest = pxToLngLat(transform, minPxX, minPxY);
    const southEast = pxToLngLat(transform, maxPxX, maxPxY);
    return [northWest.lng, southEast.lat, southEast.lng, northWest.lat];
};

/**
 * Rewrite a `/clips/{region}/{z}/{x}_{y}.webp` tile URL produced by MapLibre's
 * mercator template substitution back into game tile indexes by subtracting
 * the region's tile offset (n·2^(z-K)).
 */
export const createTileUrlRewriter = (
    transformsByRegion: () => Record<string, RegionTransform>,
): ((url: string) => string) => {
    const pattern = /\/clips\/([^/]+)\/(\d+)\/(-?\d+)_(-?\d+)([^/]*)$/;
    return (url: string) => {
        const match = pattern.exec(url);
        if (!match) return url;
        const [, regionId, zoomText, xText, yText, suffix] = match;
        const transform = transformsByRegion()[regionId];
        if (!transform) return url;
        const tileZoom = Number(zoomText);
        const gameZoom = tileZoom - TILE_ZOOM_OFFSET;
        if (gameZoom < 0) return url;
        const scale = 1 << gameZoom;
        const gameX = Number(xText) - transform.offsetTilesX * scale;
        const gameY = Number(yText) - transform.offsetTilesY * scale;
        return url.replace(
            pattern,
            `/clips/${regionId}/${gameZoom}/${gameX}_${gameY}${suffix}`,
        );
    };
};

/** Logical CSS pixels per tile, independent of the image's encoded dimensions. */
export const TILE_SIZE = 200;

export const LAYER_ORDER = /** @type {const} */ (['L4', 'L3', 'L2', 'L1', 'M', 'B1', 'B2', 'B3', 'B4']);

/** @typedef {{ zooms: Record<string, Record<string, Record<string, number[]>>> }} Coverage */

/** @param {Coverage} coverage */
export const getTileLayers = (coverage) => {
    const populated = new Set(Object.values(coverage.zooms).flatMap((zoom) =>
        Object.entries(zoom)
            .filter(([, rows]) => Object.values(rows).some((ranges) => ranges.length > 0))
            .map(([suffix]) => suffix)));
    return LAYER_ORDER.filter((layer) => layer === 'M' || populated.has(`_${layer.toLowerCase()}`));
};

/** Highest native level containing tiles in the displayed base/floor union.
 * @param {Coverage} coverage
 * @param {string[]} suffixes
 */
export const getMaxTileZoom = (coverage, suffixes = ['']) =>
    Math.max(0, ...Object.entries(coverage.zooms)
        .filter(([, zoom]) => suffixes.some((suffix) =>
            Object.values(zoom[suffix] ?? {}).some((ranges) => ranges.length > 0)))
        .map(([level]) => Number(level)));

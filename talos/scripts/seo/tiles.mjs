/** OG composites both layers at one scale, so use their highest common level. */
export const selectTileZoom = (coverage, suffix = '') => {
    const populated = (zoom, layer) => Object.values(zoom[layer] ?? {}).some((ranges) => ranges.length > 0);
    const zooms = Object.entries(coverage.zooms);
    const suffixes = suffix && zooms.some(([, zoom]) => populated(zoom, suffix)) ? ['', suffix] : [''];
    const levels = zooms.filter(([level, zoom]) => Number(level) <= 3
        && suffixes.every((layer) => populated(zoom, layer))).map(([level]) => Number(level));
    if (!levels.length) throw new Error(`No common OG tile level for ${suffixes.join(', ') || 'surface'}`);
    return Math.max(...levels);
};

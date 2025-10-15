// Access global objects or environment variables to avoid direct references to potentially undefined variables
const prefix =
    __ASSETS_HOST || ""

// No runtime probing/cache needed under new layout

/**
 * Get resource URL with shared resource fallback mechanism
 * @param {string} property - Resource category
 * @param {string} key - Resource key name
 * @param {string} [ext="png"] - File extension
 * @returns {string} - Assembled URL
 */
export function getResourceUrl(property, key, ext = 'png') {
    if (property === 'tiles') return `${prefix}${key}`;

    // Route per new convention:
    // - marker: all spot icons (地图点位底图) → /assets/images/marker
    // - marker/sub: sub icons overlay → /assets/images/marker/sub
    // - item: normal item icons (用于 UI 等) → /assets/images/item
    // - category: remains in /assets/images/category
    if (property === 'marker') {
        return `${prefix}/assets/images/marker/${key}.${ext}`;
    }
    if (property === 'marker/sub') {
        return `${prefix}/assets/images/marker/sub/${key}.${ext}`;
    }
    if (property === 'item') {
        return `${prefix}/assets/images/item/${key}.${ext}`;
    }
    return `${prefix}/assets/images/${property}/${key}.${ext}`;
}

export const getTileResourceUrl = (path) => getResourceUrl('tiles', path);
// remove get MarkerIconUrl - use getItemIconUrl with _spot suffix instead
export const getItemIconUrl = (key, ext = 'png') => {
    if (key && typeof key === 'string' && key.endsWith('_spot')) {
        return getResourceUrl('marker', key, ext);
    }
    return getResourceUrl('item', key, ext);
};
export const getCtgrIconUrl = (key, ext = 'svg') =>
    getResourceUrl('category', key, ext);
export const getMarkerSubIconUrl = (key, ext = 'png') =>
    getResourceUrl('marker/sub', `${key}`, ext);

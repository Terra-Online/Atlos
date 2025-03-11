const prefix = __ASSETS_HOST ?? ""

export const getTileResourceUrl = (path) => {
    return `${prefix}${path}`
}

/**
 * 
 * @param {string} key
 * @returns {string} 
 */
export function getMarkerIconUrl(key) {
    return `${prefix}/assets/images/marker/${key}.png`
}
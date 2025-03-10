const prefix = __ASSETS_HOST ?? ""

export const getTileResourceUrl = (path) => {
    return `${prefix}${path}`
}

/**
 * 
 * @param {string} path
 * @returns {string} 
 */
export function getAssetsUrl(path) {
    return `${prefix}/src/asset${path}`
}
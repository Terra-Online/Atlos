const prefix = __ASSETS_HOST ?? "";

/**
 * @param {string} type - resources type
 * @param {string} key - resource key
 * @param {string} [ext="png"] - file extension
 * @returns {string} - assembled URL
 */
export function getResourceUrl(type, key, ext = "png") {
  if (type === "tiles") return `${prefix}${key}`;

  return `${prefix}/assets/images/${type}/${key}.${ext}`;
}

export const getTileResourceUrl = (path) => getResourceUrl("tiles", path);
export const getMarkerIconUrl = (key) => getResourceUrl("marker", key);
export const getItemIconUrl = (key) => getResourceUrl("item", key);
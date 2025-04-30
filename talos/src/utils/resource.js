// Access global objects or environment variables to avoid direct references to potentially undefined variables
const prefix = (typeof window !== 'undefined' && window.__asset_HOST) ||ff
               (typeof process !== 'undefined' && process.env.ASSET_HOST) ||
               "";

// Cache for previously checked resource paths
const resourceCache = {
  exists: new Set(),     // Resources confirmed to exist in shared directory
  notExists: new Set()   // Resources confirmed not to exist in shared directory
};

/**
 * Get resource URL with shared resource fallback mechanism
 * @param {string} property - Resource category
 * @param {string} key - Resource key name
 * @param {string} [ext="png"] - File extension
 * @returns {string} - Assembled URL
 */
export function getResourceUrl(property, key, ext = "png") {
  if (property === "tiles") return `${prefix}${key}`;
  // Enable shared resource fallback only for marker and item
  if (property === "marker" || property === "item") {
    // Check if resource is known to exist in shared directory
    if (resourceCache.exists.has(`${key}.${ext}`)) {
      return `${prefix}/assets/images/shared/${key}.${ext}`;
    }
    // Check if resource is known not to exist in shared directory
    if (!resourceCache.notExists.has(`${key}.${ext}`)) {
      // Try loading the resource from shared directory
      const img = new Image();
      const sharedUrl = `${prefix}/assets/images/shared/${key}.${ext}`;
      img.onload = () => {
        // Resource exists, add to cache
        resourceCache.exists.add(`${key}.${ext}`);
      };
      img.onerror = () => {
        // Resource doesn't exist, add to cache
        resourceCache.notExists.add(`${key}.${ext}`);
      };
      // Start loading the image to check existence
      img.src = sharedUrl;
      // On first attempt, assume resource exists in shared directory
      return sharedUrl;
    }
  }

  // Default path
  return `${prefix}/assets/images/${property}/${key}.${ext}`;
}

export const getTileResourceUrl = (path) => getResourceUrl("tiles", path);
export const getMarkerIconUrl = (key, ext = "png") => getResourceUrl("marker", key, ext);
export const getItemIconUrl = (key, ext = "png") => getResourceUrl("item", key, ext);
export const getCtgrIconUrl = (key, ext = "svg") => getResourceUrl("category", key, ext);
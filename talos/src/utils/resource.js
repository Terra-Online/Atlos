// Access global objects or environment variables to avoid direct references to potentially undefined variables
const prefix = (typeof window !== 'undefined' && window.__asset_HOST) ||
               (typeof process !== 'undefined' && process.env.ASSET_HOST) ||
               "";

// Initialize cache from localStorage if available
const resourceCache = {
  exists: new Set(),
  notExists: new Set()
};

// Load cache from localStorage if available
try {
  if (typeof localStorage !== 'undefined') {
    const savedExists = localStorage.getItem('resourceCacheExists');
    const savedNotExists = localStorage.getItem('resourceCacheNotExists');
    
    if (savedExists) {
      JSON.parse(savedExists).forEach(item => resourceCache.exists.add(item));
    }
    
    if (savedNotExists) {
      JSON.parse(savedNotExists).forEach(item => resourceCache.notExists.add(item));
    }
  }
} catch (e) {
  console.warn('Failed to load resource cache from localStorage:', e);
}

// Helper function to save cache to localStorage
const saveCache = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('resourceCacheExists', 
        JSON.stringify([...resourceCache.exists]));
      localStorage.setItem('resourceCacheNotExists', 
        JSON.stringify([...resourceCache.notExists]));
    }
  } catch (e) {
    console.warn('Failed to save resource cache to localStorage:', e);
  }
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
  
  const resourceKey = `${key}.${ext}`;
  const defaultUrl = `${prefix}/asset/images/${property}/${key}.${ext}`;
  const sharedUrl = `${prefix}/asset/images/shared/${key}.${ext}`;
  
  // Enable shared resource fallback only for marker and item
  if (property === "marker" || property === "item") {
    // Check if resource is known to exist in shared directory
    if (resourceCache.exists.has(resourceKey)) {
      return sharedUrl;
    }
    
    // Check if resource is known not to exist in shared directory
    if (resourceCache.notExists.has(resourceKey)) {
      return defaultUrl;
    }
    
    // We don't know yet - prefer the original URL for safety and check in background
    const img = new Image();
    
    img.onload = () => {
      resourceCache.exists.add(resourceKey);
      saveCache();
    };
    
    img.onerror = () => {
      resourceCache.notExists.add(resourceKey);
      saveCache();
    };
    
    img.src = sharedUrl;
    
    // Return default URL to ensure something displays
    return defaultUrl;
  }

  return defaultUrl;
}

export const getTileResourceUrl = (path) => getResourceUrl("tiles", path);
export const getMarkerIconUrl = (key, ext = "png") => getResourceUrl("marker", key, ext);
export const getItemIconUrl = (key, ext = "png") => getResourceUrl("item", key, ext);
export const getCtgrIconUrl = (key, ext = "svg") => getResourceUrl("category", key, ext);
// Font caching utility using Cache API
// Provides cache-first strategy for font files to avoid re-downloading on language switch

const CACHE_NAME = 'talos-font-cache-v1';
const CACHE_EXPIRY_DAYS = 30; // Cache fonts for 30 days

interface CachedFontMetadata {
    url: string;
    cachedAt: number;
}

// Check if Cache API is available
const isCacheAvailable = (): boolean => {
    return typeof caches !== 'undefined';
};

// Get cached font metadata from localStorage
const getCacheMetadata = (): Record<string, CachedFontMetadata> => {
    try {
        const data = localStorage.getItem('talos:font-cache-metadata');
        return data ? (JSON.parse(data) as Record<string, CachedFontMetadata>) : {};
    } catch {
        return {};
    }
};

// Set cached font metadata in localStorage
const setCacheMetadata = (url: string): void => {
    try {
        const metadata = getCacheMetadata();
        metadata[url] = {
            url,
            cachedAt: Date.now(),
        };
        localStorage.setItem('talos:font-cache-metadata', JSON.stringify(metadata));
    } catch {
        // Ignore localStorage errors
    }
};

// Check if cached font is expired
const isCacheExpired = (url: string): boolean => {
    const metadata = getCacheMetadata();
    const entry = metadata[url];
    
    if (!entry) return true;
    
    const expiryTime = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - entry.cachedAt > expiryTime;
};

/**
 * Preload and cache a font file
 * @param url Font file URL
 * @returns Promise that resolves when font is cached
 */
export async function cacheFontFile(url: string): Promise<void> {
    if (!isCacheAvailable()) {
        console.warn('Cache API not available, skipping font caching');
        return;
    }

    try {
        const cache = await caches.open(CACHE_NAME);
        
        // Check if already cached and not expired
        const cachedResponse = await cache.match(url);
        if (cachedResponse && !isCacheExpired(url)) {
            console.log(`Font already cached: ${url}`);
            return;
        }

        // Fetch and cache the font
        console.log(`Caching font: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch font: ${url}`);
        }

        await cache.put(url, response);
        setCacheMetadata(url);
        
        console.log(`Font cached successfully: ${url}`);
    } catch (error) {
        console.error(`Failed to cache font ${url}:`, error);
    }
}

/**
 * Preload multiple font files
 * @param urls Array of font file URLs
 * @returns Promise that resolves when all fonts are cached
 */
export async function preloadFonts(urls: string[]): Promise<void> {
    if (!isCacheAvailable()) {
        console.warn('Cache API not available, skipping font preloading');
        return;
    }

    console.log(`Preloading ${urls.length} fonts...`);
    
    // Use Promise.allSettled to continue even if some fonts fail
    const results = await Promise.allSettled(
        urls.map(url => cacheFontFile(url))
    );
    
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    console.log(`Font preloading complete: ${succeeded} succeeded, ${failed} failed`);
}

/**
 * Get cached font or fetch from network
 * @param url Font file URL
 * @returns Response object
 */
export async function getCachedFont(url: string): Promise<Response> {
    if (!isCacheAvailable()) {
        return fetch(url);
    }

    try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(url);
        
        // Return cached response if available and not expired
        if (cachedResponse && !isCacheExpired(url)) {
            console.log(`Serving font from cache: ${url}`);
            return cachedResponse;
        }

        // Fetch from network and update cache
        console.log(`Fetching font from network: ${url}`);
        const response = await fetch(url);
        
        if (response.ok) {
            await cache.put(url, response.clone());
            setCacheMetadata(url);
        }
        
        return response;
    } catch (error) {
        console.error(`Error getting cached font ${url}:`, error);
        return fetch(url);
    }
}

/**
 * Clear expired font cache entries
 */
export async function cleanupFontCache(): Promise<void> {
    if (!isCacheAvailable()) return;

    try {
        const cache = await caches.open(CACHE_NAME);
        const requests = await cache.keys();
        const metadata = getCacheMetadata();
        
        let cleaned = 0;
        
        for (const request of requests) {
            if (isCacheExpired(request.url)) {
                await cache.delete(request);
                delete metadata[request.url];
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            localStorage.setItem('talos:font-cache-metadata', JSON.stringify(metadata));
            console.log(`Cleaned up ${cleaned} expired font cache entries`);
        }
    } catch (error) {
        console.error('Failed to cleanup font cache:', error);
    }
}

/**
 * Get all font URLs from font definitions for a specific region
 * Returns dev paths (/src/assets/...) - caller applies CDN conversion for prod
 */
export function getFontUrlsForRegion(region: 'CN' | 'HK' | 'JP'): string[] {
    const fontDefinitions = [
        {
            cnFiles: {
                woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_B.woff2',
                woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_B.woff',
            },
            hkFiles: {
                woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_B.woff2',
                woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_B.woff',
            },
            jpFiles: {
                woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_B.woff2',
                woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_B.woff',
            }
        },
        {
            cnFiles: {
                woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_DB.woff2',
                woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_DB.woff',
            },
            hkFiles: {
                woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_DB.woff2',
                woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_DB.woff',
            },
            jpFiles: {
                woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_DB.woff2',
                woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_DB.woff',
            }
        },
        {
            cnFiles: {
                woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_M.woff2',
                woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_M.woff',
            },
            hkFiles: {
                woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_M.woff2',
                woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_M.woff',
            },
            jpFiles: {
                woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_M.woff2',
                woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_M.woff',
            }
        },
        {
            cnFiles: {
                woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_R.woff2',
                woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_R.woff',
            },
            hkFiles: {
                woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_R.woff2',
                woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_R.woff',
            },
            jpFiles: {
                woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_R.woff2',
                woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_R.woff',
            }
        },
        {
            cnFiles: {
                woff2: '/src/assets/fonts/Harmony/HMSans_SC.woff2',
                woff: '/src/assets/fonts/Harmony/HMSans_SC.woff',
            },
            hkFiles: {
                woff2: '/src/assets/fonts/Harmony/HMSans_TC.woff2',
                woff: '/src/assets/fonts/Harmony/HMSans_TC.woff',
            }
        }
    ];

    const urls: string[] = [];
    
    for (const def of fontDefinitions) {
        const files = region === 'CN' ? def.cnFiles : 
                      region === 'HK' ? def.hkFiles : 
                      def.jpFiles;
        
        if (files) {
            // Prefer woff2, fallback to woff
            if (files.woff2) urls.push(files.woff2);
            else if (files.woff) urls.push(files.woff);
        }
    }
    
    return urls;
}

// Auto cleanup on initialization
if (isCacheAvailable()) {
    cleanupFontCache().catch(err => console.error('Font cache cleanup failed:', err));
}

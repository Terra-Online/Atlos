import logger from '@/utils/log';

// Import font assets so Vite can hash and emit them
import UDShinGo_CN_B_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_B.woff2';
import UDShinGo_CN_B_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_B.woff';
import UDShinGo_HK_B_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_B.woff2';
import UDShinGo_HK_B_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_B.woff';
import UDShinGo_JP_B_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_B.woff2';
import UDShinGo_JP_B_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_B.woff';

import UDShinGo_CN_DB_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_DB.woff2';
import UDShinGo_CN_DB_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_DB.woff';
import UDShinGo_HK_DB_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_DB.woff2';
import UDShinGo_HK_DB_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_DB.woff';
import UDShinGo_JP_DB_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_DB.woff2';
import UDShinGo_JP_DB_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_DB.woff';

import UDShinGo_CN_M_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_M.woff2';
import UDShinGo_CN_M_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_M.woff';
import UDShinGo_HK_M_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_M.woff2';
import UDShinGo_HK_M_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_M.woff';
import UDShinGo_JP_M_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_M.woff2';
import UDShinGo_JP_M_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_M.woff';

import UDShinGo_CN_R_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_R.woff2';
import UDShinGo_CN_R_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_R.woff';
import UDShinGo_HK_R_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_R.woff2';
import UDShinGo_HK_R_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_R.woff';
import UDShinGo_JP_R_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_R.woff2';
import UDShinGo_JP_R_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_R.woff';

import HMSans_SC_woff2 from '@/assets/fonts/Harmony/HMSans_SC.woff2';
import HMSans_SC_woff from '@/assets/fonts/Harmony/HMSans_SC.woff';
import HMSans_TC_woff2 from '@/assets/fonts/Harmony/HMSans_TC.woff2';
import HMSans_TC_woff from '@/assets/fonts/Harmony/HMSans_TC.woff';

const CACHE_NAME = 'Talos_FontCache';
const CACHE_EXPIRY_DAYS = 30; // Cache fonts for 30 days

interface CachedFontMetadata {
    url: string;
    cachedAt: number;
}

// Normalize URL to absolute path for consistent cache keys
const normalizeUrl = (url: string): string => {
    try {
        return new URL(url, window.location.href).href;
    } catch {
        return url;
    }
};

// Check if Cache API is available
const isCacheAvailable = (): boolean => {
    return typeof caches !== 'undefined';
};

// Get cached font metadata from localStorage
const getCacheMetadata = (): Record<string, CachedFontMetadata> => {
    try {
        const data = localStorage.getItem('Talos:fontMetadata');
        return data ? (JSON.parse(data) as Record<string, CachedFontMetadata>) : {};
    } catch {
        return {};
    }
};

// Set cached font metadata in localStorage
const setCacheMetadata = (url: string): void => {
    try {
        const fullUrl = normalizeUrl(url);
        const metadata = getCacheMetadata();
        metadata[fullUrl] = {
            url: fullUrl,
            cachedAt: Date.now(),
        };
        localStorage.setItem('Talos:fontMetadata', JSON.stringify(metadata));
    } catch {
        // Ignore localStorage errors
    }
};

// Check if cached font is expired
const isCacheExpired = (url: string): boolean => {
    const fullUrl = normalizeUrl(url);
    const metadata = getCacheMetadata();
    const entry = metadata[fullUrl];
    
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
        logger.debug('Cache API not available, skipping font caching');
        return;
    }

    try {
        const cache = await caches.open(CACHE_NAME);
        
        // Check if already cached and not expired
        const cachedResponse = await cache.match(url);
        if (cachedResponse && !isCacheExpired(url)) {
            logger.debug(`Font already cached: ${url}`);
            return;
        }

        // Fetch and cache the font
        logger.debug(`Caching font: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch font: ${url}`);
        }

        await cache.put(url, response);
        setCacheMetadata(url);
        
        logger.debug(`Font cached successfully: ${url}`);
    } catch (error) {
        logger.debug(`Failed to cache font ${url}:`, error);
    }
}

/**
 * Preload multiple font files
 * @param urls Array of font file URLs
 * @returns Promise that resolves when all fonts are cached
 */
export async function preloadFonts(urls: string[]): Promise<void> {
    if (!isCacheAvailable()) {
        logger.debug('Cache API not available, skipping font preloading');
        return;
    }

    logger.debug(`Preloading ${urls.length} fonts...`);
    
    // Use Promise.allSettled to continue even if some fonts fail
    const results = await Promise.allSettled(
        urls.map(url => cacheFontFile(url))
    );
    
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    logger.debug(`Font preloading complete: ${succeeded} succeeded, ${failed} failed`);
}

/**
 * Get cached font blob if available
 * @param url Font file URL
 * @returns Blob if cached and valid, null otherwise
 */
export async function getCachedFontBlob(url: string): Promise<Blob | null> {
    if (!isCacheAvailable()) return null;

    try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(url);
        
        if (cachedResponse && !isCacheExpired(url)) {
            logger.debug(`Hit font cache: ${url}`);
            return await cachedResponse.blob();
        }
        return null;
    } catch (error) {
        logger.debug(`Error checking font cache ${url}:`, error);
        return null;
    }
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
            logger.debug(`Serving font from cache: ${url}`);
            return cachedResponse;
        }

        // Fetch from network and update cache
        logger.debug(`Fetching font from network: ${url}`);
        const response = await fetch(url);
        
        if (response.ok) {
            await cache.put(url, response.clone());
            setCacheMetadata(url);
        }
        
        return response;
    } catch (error) {
        logger.debug(`Error getting cached font ${url}:`, error);
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
            localStorage.setItem('Talos:fontMetadata', JSON.stringify(metadata));
            logger.debug(`Cleaned up ${cleaned} expired font cache entries`);
        }
    } catch (error) {
        logger.debug('Failed to cleanup font cache:', error);
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
                woff2: UDShinGo_CN_B_woff2,
                woff: UDShinGo_CN_B_woff,
            },
            hkFiles: {
                woff2: UDShinGo_HK_B_woff2,
                woff: UDShinGo_HK_B_woff,
            },
            jpFiles: {
                woff2: UDShinGo_JP_B_woff2,
                woff: UDShinGo_JP_B_woff,
            }
        },
        {
            cnFiles: {
                woff2: UDShinGo_CN_DB_woff2,
                woff: UDShinGo_CN_DB_woff,
            },
            hkFiles: {
                woff2: UDShinGo_HK_DB_woff2,
                woff: UDShinGo_HK_DB_woff,
            },
            jpFiles: {
                woff2: UDShinGo_JP_DB_woff2,
                woff: UDShinGo_JP_DB_woff,
            }
        },
        {
            cnFiles: {
                woff2: UDShinGo_CN_M_woff2,
                woff: UDShinGo_CN_M_woff,
            },
            hkFiles: {
                woff2: UDShinGo_HK_M_woff2,
                woff: UDShinGo_HK_M_woff,
            },
            jpFiles: {
                woff2: UDShinGo_JP_M_woff2,
                woff: UDShinGo_JP_M_woff,
            }
        },
        {
            cnFiles: {
                woff2: UDShinGo_CN_R_woff2,
                woff: UDShinGo_CN_R_woff,
            },
            hkFiles: {
                woff2: UDShinGo_HK_R_woff2,
                woff: UDShinGo_HK_R_woff,
            },
            jpFiles: {
                woff2: UDShinGo_JP_R_woff2,
                woff: UDShinGo_JP_R_woff,
            }
        },
        {
            cnFiles: {
                woff2: HMSans_SC_woff2,
                woff: HMSans_SC_woff,
            },
            hkFiles: {
                woff2: HMSans_TC_woff2,
                woff: HMSans_TC_woff,
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
    cleanupFontCache().catch(err => logger.debug('Font cache cleanup failed:', err));
}
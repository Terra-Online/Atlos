import logger from '@/utils/log';

import { getFontAssetUrls } from './fontAssets';

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
 */
export async function preloadFonts(urls: string[]): Promise<void> {
    if (!isCacheAvailable()) {
        logger.debug('Cache API not available, skipping font preloading');
        return;
    }

    logger.debug(`Preloading ${urls.length} fonts...`);

    // Use Promise.allSettled to continue even if some fonts fail
    const results = await Promise.allSettled(urls.map(url => cacheFontFile(url)));

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logger.debug(`Font preloading complete: ${succeeded} succeeded, ${failed} failed`);
}

/**
 * Get cached font buffer if available
 * @param url Font file URL
 * @returns ArrayBuffer if cached and valid, null otherwise
 */
export async function getCachedFontBuffer(url: string): Promise<ArrayBuffer | null> {
    if (!isCacheAvailable()) return null;

    try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(url);

        if (cachedResponse && !isCacheExpired(url)) {
            logger.debug(`Hit font cache: ${url}`);
            return await cachedResponse.arrayBuffer();
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
 * Get all font URLs for a specific region.
 * Uses build-time glob registry: missing font files simply won't be included.
 */
export function getFontUrlsForRegion(region: 'CN' | 'HK' | 'JP'): string[] {
    const regionPrefix = region === 'CN' ? 'CN' : region === 'HK' ? 'HK' : 'JP';
    const weights = ['B', 'DB', 'M', 'R'] as const;

    const candidates: string[] = [];
    for (const weight of weights) {
        candidates.push(`UD_ShinGo/UDShinGo_${regionPrefix}_${weight}.woff2`);
        candidates.push(`UD_ShinGo/UDShinGo_${regionPrefix}_${weight}.woff`);
    }

    if (region === 'CN') {
        candidates.push('Harmony/HMSans_SC.woff2');
        candidates.push('Harmony/HMSans_SC.woff');
    } else if (region === 'HK') {
        candidates.push('Harmony/HMSans_TC.woff2');
        candidates.push('Harmony/HMSans_TC.woff');
    }

    return getFontAssetUrls(candidates);
}

// Auto cleanup on initialization
if (isCacheAvailable()) {
    cleanupFontCache().catch((err: unknown) => logger.debug('Font cache cleanup failed:', err));
}
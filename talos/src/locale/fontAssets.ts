type UrlModuleMap = Record<string, string>;

const normalizeRelPath = (p: string): string => {
    const marker = '/assets/fonts/';
    const idx = p.lastIndexOf(marker);
    if (idx >= 0) return p.slice(idx + marker.length);

    // Fallback: when Vite keeps the relative glob key
    return p.replace(/^\.\.\/assets\/fonts\//, '').replace(/^\.\/assets\/fonts\//, '');
};

// Eagerly collect available font assets at build-time.
// If some font files are missing in the repo/CI, they simply won't appear here (no hard build failure).
const fontAssetUrlModules = import.meta.glob(
    '../assets/fonts/**/*.{woff2,woff,otf,ttf}',
    { eager: true, query: '?url', import: 'default' }
) as UrlModuleMap;

const FONT_ASSET_URLS: Record<string, string> = Object.fromEntries(
    Object.entries(fontAssetUrlModules).map(([path, url]) => [normalizeRelPath(path), url])
);

export const getFontAssetUrl = (relPath: string): string | undefined => {
    return FONT_ASSET_URLS[relPath];
};

export const getFontAssetUrls = (relPaths: string[]): string[] => {
    const urls: string[] = [];
    for (const relPath of relPaths) {
        const url = getFontAssetUrl(relPath);
        if (url) urls.push(url);
    }
    return urls;
};
const normalizePath = (path: string): string => {
    const marker = '/assets/fonts/';
    const index = path.lastIndexOf(marker);
    return index >= 0
        ? path.slice(index + marker.length)
        : path
              .replace(/^\.\.\/assets\/fonts\//, '')
              .replace(/^\.\/assets\/fonts\//, '');
};

export const indexFontAssets = (modules: Record<string, string>) => {
    const urls = Object.fromEntries(
        Object.entries(modules).map(([path, url]) => [
            normalizePath(path),
            url,
        ]),
    );
    const getFontAssetUrl = (path: string): string | undefined => urls[path];
    const getFontAssetUrls = (paths: string[]): string[] =>
        paths.flatMap((path) => {
            const url = getFontAssetUrl(path);
            return url ? [url] : [];
        });
    return { getFontAssetUrl, getFontAssetUrls };
};

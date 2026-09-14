type UrlModuleMap = Record<string, string>;

const normalizeRelPath = (path: string): string => {
  const marker = '/assets/fonts/';
  const index = path.lastIndexOf(marker);
  if (index >= 0) return path.slice(index + marker.length);

  // Fallback: when Vite keeps the relative glob key
  return path
    .replace(/^\.\.\/assets\/fonts\//, '')
    .replace(/^\.\/assets\/fonts\//, '');
};

const fontAssetUrlModules = import.meta.glob(
  [
    '../assets/fonts/UD_ShinGo/*.woff2',
    '../assets/fonts/Harmony/*.woff2',
  ],
  { eager: true, query: '?url', import: 'default' },
) as UrlModuleMap;

const fontAssetUrls: Record<string, string> = Object.fromEntries(
  Object.entries(fontAssetUrlModules).map(([path, url]) => [normalizeRelPath(path), url]),
);

export const getFontAssetUrl = (relPath: string): string | undefined => fontAssetUrls[relPath];

export const getFontAssetUrls = (relPaths: string[]): string[] => relPaths.flatMap((relPath) => {
  const url = getFontAssetUrl(relPath);
  return url ? [url] : [];
});

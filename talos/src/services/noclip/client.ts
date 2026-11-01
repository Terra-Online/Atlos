import { pointPath } from './route';
import { isCatalog, type Catalog } from './types';

const catalogUrl = import.meta.env.VITE_WORLD_CATALOG_URL as string | undefined;
export const viewerUrl =
    (import.meta.env.VITE_WORLD_URL as string | undefined) ||
    'https://world.opendfieldmap.org/';
export const enabled = Boolean(catalogUrl);
let catalogRequest: Promise<Catalog> | undefined;

const json = async (url: string): Promise<unknown> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`3D data: HTTP ${response.status}`);
    return response.json();
};
export const loadCatalog = (): Promise<Catalog> => {
    if (!catalogUrl)
        return Promise.reject(new Error('3D release is not configured'));
    catalogRequest ??= json(catalogUrl)
        .then((v) => {
            if (!isCatalog(v)) throw new Error('Invalid 3D release');
            return v;
        })
        .catch((error: unknown) => {
            catalogRequest = undefined;
            throw error;
        });
    return catalogRequest;
};

export const previewLink = (point: string): string => {
    const url = new URL(viewerUrl, location.href);
    url.pathname = pointPath(point);
    url.search = '';
    url.hash = '';
    return url.href;
};

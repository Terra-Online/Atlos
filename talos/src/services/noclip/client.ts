import { isCatalog, type Catalog } from './types';

const catalogUrl = import.meta.env.VITE_NOCLIP_CATALOG_URL as
    | string
    | undefined;
export const viewerUrl =
    (import.meta.env.VITE_NOCLIP_VIEWER_URL as string | undefined) ||
    'https://oem-noclip.pages.dev/';
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

export const previewLink = (
    point: string,
    release: string,
    session = '',
): string => {
    const url = new URL(viewerUrl, location.href);
    url.searchParams.set('oem', new URL(catalogUrl!, location.href).href);
    url.searchParams.set('release', release);
    url.searchParams.set('point', point);
    url.searchParams.set('origin', location.origin);
    url.searchParams.set('session', session);
    return url.href;
};

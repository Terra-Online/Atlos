import { isCatalog, isCompanion, type Catalog, type Companion } from './types';

const catalogUrl = import.meta.env.VITE_NOCLIP_CATALOG_URL as
    | string
    | undefined;
export const viewerUrl =
    (import.meta.env.VITE_NOCLIP_VIEWER_URL as string | undefined) ||
    'https://oem-noclip.pages.dev/';
export const enabled = Boolean(catalogUrl);
let catalogRequest: Promise<Catalog> | undefined;
const requests = new Map<string, Promise<Companion>>();

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

export const loadPoint = async (id: string) => {
    const catalog = await loadCatalog(),
        partition = catalog.pointIndex[id];
    const file = catalog.files[partition];
    if (typeof file !== 'string') return null;
    let request = requests.get(partition);
    if (!request) {
        request = json(new URL(file, catalogUrl).href)
            .then((v) => {
                if (!isCompanion(v) || v.release !== catalog.release)
                    throw new Error('Invalid 3D companion');
                return v;
            })
            .catch((error: unknown) => {
                requests.delete(partition);
                throw error;
            });
        requests.set(partition, request);
    }
    const companion = await request,
        point = companion.points.find((p) => p.id === id);
    return point ? { catalog, companion, point } : null;
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

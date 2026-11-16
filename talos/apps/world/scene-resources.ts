import { isCatalog, type Catalog } from '@endfield-noclip/package-format/oem';
/** A release is immutable; failed reads may be retried without caching failure. */
export function sceneCatalog(url: string | undefined) {
    let pending: Promise<Catalog> | undefined;
    return async (scene: string) => {
        if (!url) throw new Error('Scene catalogue is not configured');
        pending ??= (async () => {
            const response = await fetch(url);
            if (!response.ok)
                throw new Error(`Scene catalogue: HTTP ${response.status}`);
            const value: unknown = await response.json();
            if (!isCatalog(value)) throw new Error('Invalid scene catalogue');
            return value;
        })().catch((error) => {
            pending = undefined;
            throw error;
        });
        const catalog = await pending,
            pack = catalog.packages[scene];
        if (!pack) throw new Error('Scene is not in this release');
        return { generation: pack.generation, source: catalog.source };
    };
}

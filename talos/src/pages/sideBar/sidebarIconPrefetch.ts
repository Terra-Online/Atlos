interface Request {
    owners: Set<symbol>;
    document: Document;
}
const waiting = new Map<string, Request>();
const loading = new Set<string>();
const ready = new Set<string>();
const MAX_READY = 256;
const MAX_LOADING = 6;

function drain() {
    for (const [url, request] of waiting) {
        if (loading.size >= MAX_LOADING) break;
        waiting.delete(url);
        const Image = request.document.defaultView?.Image;
        if (!Image || !request.owners.size || ready.has(url)) continue;
        loading.add(url);
        const image = new Image();
        image.decoding = 'async';
        const finish = (success: boolean) => {
            image.onload = null; image.onerror = null;
            loading.delete(url);
            if (success) {
                ready.add(url);
                if (ready.size > MAX_READY) ready.delete(ready.values().next().value!);
            }
            drain();
        };
        image.onload = () => { void image.decode().then(() => finish(true), () => finish(true)); };
        image.onerror = () => finish(false);
        image.src = url;
    }
}

/** Callers supply visible icons first, then adjacent rows from the current region. */
export function preloadSidebarIcons(urls: readonly string[], document: Document): () => void {
    const owner = Symbol();
    for (const url of urls) {
        if (ready.has(url) || loading.has(url)) continue;
        const request = waiting.get(url) ?? { owners: new Set<symbol>(), document };
        request.owners.add(owner); waiting.set(url, request);
    }
    drain();
    return () => {
        for (const [url, request] of waiting) {
            request.owners.delete(owner);
            if (!request.owners.size) waiting.delete(url);
        }
    };
}

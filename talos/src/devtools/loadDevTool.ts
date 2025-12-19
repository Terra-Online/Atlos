import type L from 'leaflet';

declare global {
    interface Window {
        __TALOS_DEV__?: {
            map?: L.Map;
        };
    }
}

const hasLabelToolFlag = (): boolean => {
    try {
        if (typeof window === 'undefined') return false;
        const url = new URL(window.location.href);
        return url.searchParams.get('labelTool') === '1';
    } catch {
        return false;
    }
};

const waitForMap = async (): Promise<L.Map | null> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const map = window.__TALOS_DEV__?.map;
        if (map) return map;
        await new Promise((r) => setTimeout(r, 100));
    }
    return null;
};

export const loadLabelTool = async (): Promise<void> => {
    if (!import.meta.env.DEV) return;
    if (!hasLabelToolFlag()) return;

    const map = await waitForMap();
    if (!map) return;

    try {
        // Local-only devtool entry. This path is intentionally gitignored.
        const entry: string = '/src/devtools/labelTool/bootstrap.tsx';
        const mod: unknown = await import(/* @vite-ignore */ entry);
        const bootstrap = (mod as { bootstrapLabelTool?: (m: L.Map) => void } | null | undefined)?.bootstrapLabelTool;
        if (typeof bootstrap === 'function') bootstrap(map);
    } catch {
        // Tool is optional and local-only.
    }
};

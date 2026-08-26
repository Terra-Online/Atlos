import type { TalosMap } from '@/component/mapCore/engine';

declare global {
    interface Window {
        __TALOS_DEV__?: {
            map?: TalosMap;
            mapCore?: unknown;
        };
    }
}

const initialSearch = typeof window !== 'undefined' ? window.location.search : '';

const hasFlag = (flag: string): boolean => {
    try {
        if (typeof window === 'undefined') return false;
        const initialParams = new URLSearchParams(initialSearch);
        if (initialParams.get(flag) === '1') return true;

        const currentParams = new URLSearchParams(window.location.search);
        return currentParams.get(flag) === '1';
    } catch {
        return false;
    }
};

const hasLabelToolFlag = (): boolean => hasFlag('labelTool');

const hasLinkToolFlag = (): boolean => hasFlag('linkTool');

const hasMarkToolFlag = (): boolean => hasFlag('markTool');

export const isRecordToolEnabled = (): boolean => import.meta.env.DEV && hasFlag('recordTool');

const waitForMap = async (): Promise<TalosMap | null> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const map = window.__TALOS_DEV__?.map;
        if (map) return map;
        await new Promise((r) => setTimeout(r, 100));
    }
    return null;
};

const readBootstrap = (mod: unknown, key: string): ((map: TalosMap) => void) | null => {
    if (!mod || typeof mod !== 'object') return null;
    const candidate = (mod as Record<string, unknown>)[key];
    if (typeof candidate !== 'function') return null;
    return candidate as (map: TalosMap) => void;
};

export const loadLabelTool = async (): Promise<void> => {
    if (!import.meta.env.DEV) return;
    if (!hasLabelToolFlag()) return;

    const map = await waitForMap();
    if (!map) return;

    try {
        const mod: unknown = await import('./labelTool/bootstrap');
        const bootstrap = readBootstrap(mod, 'bootstrapLabelTool');
        if (bootstrap) bootstrap(map);
    } catch {
        // Tool is optional and local-only.
    }
};

export const loadLinkTool = async (): Promise<void> => {
    if (!import.meta.env.DEV) return;
    if (!hasLinkToolFlag()) return;

    const map = await waitForMap();
    if (!map) return;

    try {
        const mod: unknown = await import('./linkTool/bootstrap');
        const bootstrap = readBootstrap(mod, 'bootstrapLinkTool');
        if (bootstrap) bootstrap(map);
    } catch (e) {
        console.error('[LinkTool] Failed to load:', e);
    }
};

export const loadMarkTool = async (): Promise<void> => {
    if (!import.meta.env.DEV) return;
    if (!hasMarkToolFlag()) return;

    const map = await waitForMap();
    if (!map) return;

    try {
        const mod: unknown = await import('./markTool/bootstrap.tsx');
        const bootstrap = readBootstrap(mod, 'bootstrapMarkTool');
        if (bootstrap) bootstrap(map);
    } catch (e) {
        console.error('[MarkTool] Failed to load:', e);
    }
};

export const loadDevTools = (): void => {
    void loadLabelTool();
    void loadLinkTool();
    void loadMarkTool();
};

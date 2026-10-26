import { act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const startup = vi.hoisted(() => {
    const resolved = () => Promise.resolve();
    return {
        render: vi.fn(), createRoot: vi.fn(), devtools: vi.fn(),
        region: vi.fn(() => Promise.resolve('Wuling')),
        apply: vi.fn(resolved), prepare: vi.fn(resolved), font: vi.fn(resolved), mapFonts: vi.fn((_region: string) => Promise.resolve()),
        markers: vi.fn((_region: string) => Promise.resolve([])), tiles: vi.fn(),
        state: {} as { pointId?: string; pointToken?: string; typeKey?: string; regionKey?: string; coordinate?: [number, number]; zoom?: number },
        initial: undefined as { kind: string; regionId: string; view: { lat: number; lng: number; zoom: number } } | undefined,
    };
});
vi.mock('react-dom/client', () => ({ createRoot: startup.createRoot }));
vi.mock('./pages/MapPage', () => ({ default: () => null }));
vi.mock('./locale/fontLoader.ts', () => ({ fontLoader: startup.font }));
vi.mock('@/locale', () => ({ i18nInitPromise: Promise.resolve(), preloadMapFonts: startup.mapFonts }));
vi.mock('@/devtools/loadDevTool', () => ({ loadDevTools: startup.devtools }));
vi.mock('@/services/routing', () => ({ applyUrlParams: startup.apply, resolveInitialRegion: startup.region, parseUrlState: () => startup.state }));
vi.mock('@/data/marker', () => ({ loadRegionMarkers: startup.markers }));
vi.mock('@/services/map/preload', () => ({ preloadMapTiles: startup.tiles }));
vi.mock('@/data/map', () => ({ REGION_DICT: { Wuling: { initialZoom: 2 } } }));
vi.mock('@/services/map/navigation', () => ({ prepareInitialNavigation: startup.prepare, getInitialNavigationView: () => startup.initial }));

let root: HTMLElement;
beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    startup.createRoot.mockReturnValue({ render: startup.render });
    startup.font.mockImplementation(() => Promise.resolve());
    startup.mapFonts.mockImplementation(() => Promise.resolve());
    startup.prepare.mockImplementation(() => Promise.resolve());
    startup.state = {};
    startup.initial = undefined;
    root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
});
afterEach(() => { root.remove(); vi.restoreAllMocks(); });
const bootstrap = async () => { await act(async () => { await import('./main'); await vi.dynamicImportSettled(); }); };

it('starts region resources early and waits for navigation and both font gates before mounting', async () => {
    let finishFont!: () => void;
    let finishMapFonts!: () => void;
    startup.font.mockImplementation(() => new Promise<void>((resolve) => { finishFont = resolve; }));
    startup.mapFonts.mockImplementation(() => new Promise<void>((resolve) => { finishMapFonts = resolve; }));
    await bootstrap();
    expect(startup.markers).toHaveBeenCalledWith('Wuling');
    expect(startup.tiles).toHaveBeenCalledWith('Wuling', undefined);
    expect(startup.apply).toHaveBeenCalledBefore(startup.prepare);
    expect(startup.prepare).toHaveBeenCalledBefore(startup.font);
    expect(startup.mapFonts).not.toHaveBeenCalled();
    expect(startup.render).not.toHaveBeenCalled();
    await act(async () => { finishFont(); await Promise.resolve(); });
    expect(startup.mapFonts).toHaveBeenCalledWith('Wuling');
    expect(startup.render).not.toHaveBeenCalled();
    await act(async () => { finishMapFonts(); await Promise.resolve(); });
    expect(startup.createRoot).toHaveBeenCalledExactlyOnceWith(root);
    expect(startup.render).toHaveBeenCalledOnce();
    expect(startup.devtools).toHaveBeenCalledOnce();
});

it('preloads only a resolved shared point view, rather than the default region view', async () => {
    startup.state = { pointToken: 'token' };
    startup.initial = { kind: 'point', regionId: 'Wuling', view: { lat: 10, lng: 20, zoom: 4 } };
    await bootstrap();
    expect(startup.tiles).toHaveBeenCalledExactlyOnceWith('Wuling', startup.initial.view);
    expect(startup.render).toHaveBeenCalledOnce();
});

it('honors coordinate URLs and continues after recoverable navigation or map-font failures', async () => {
    startup.state = { regionKey: 'Wuling', coordinate: [10, 20], zoom: 4 };
    startup.prepare.mockRejectedValueOnce(new Error('Missing shared point'));
    startup.mapFonts.mockRejectedValueOnce(new Error('Font offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await bootstrap();
    expect(startup.tiles).toHaveBeenCalledExactlyOnceWith('Wuling', { lat: 10, lng: 20, zoom: 4 });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(startup.render).toHaveBeenCalledOnce();
});

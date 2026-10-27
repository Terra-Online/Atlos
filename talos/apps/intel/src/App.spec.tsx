import type { ReactNode, Ref } from 'react';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installResizeObserver } from '../../../test-support/browser';
import { useUiPrefsStore } from '@main/store/uiPrefs';
import { useUserRecordStore } from '@main/store/userRecord';
import { archives, deferred, flush, translate } from './fixtures';
import App from './App';

const runtime = vi.hoisted(() => ({ mobile: false, decode: vi.fn() }));
vi.mock('@intel/data/types', async () => {
    const { archives } = await import('./fixtures');
    return { intelArchives: archives, archiveById: new Map(archives.map((item) => [item.id, item])) };
});
vi.mock('@intel/locale', async () => {
    const { translate } = await import('./fixtures');
    return { useLocale: () => 'en-US', useTranslateUI: () => translate, useTranslateGame: () => translate };
});
vi.mock('@main/locale', async () => {
    const { translate } = await import('./fixtures');
    return { useLocale: () => 'en-US', useTranslateUI: () => translate, useTranslateGame: () => translate };
});
vi.mock('@main/platform/device', () => ({ useDevice: () => ({ isMobile: runtime.mobile }) }));
vi.mock('@main/platform/useTheme', () => ({ useTheme: () => 'light' }));
// Shell, locale switching, and cloud sync have separate component suites. The
// real filter/search/cards/collection/selection chain runs together here.
vi.mock('@main/component/shared/siteShell/sideBar.frame', () => ({ default: ({ children, bottomTools, headIcon, contentRef }: { children: ReactNode; bottomTools: ReactNode; headIcon: ReactNode; contentRef: Ref<HTMLDivElement> }) => <aside ref={contentRef}>{headIcon}{children}{bottomTools}</aside> }));
vi.mock('@intel/components/intelHeadBar/intelHeadBar', () => ({ default: () => null }));
vi.mock('@intel/state/ArchiveProgressSyncHost', () => ({ default: () => null }));
vi.mock('@intel/data/importContract', async (original) => ({ ...await original<typeof import('./data/importContract')>(), decodeIntelImportToken: runtime.decode }));

beforeEach(() => {
    vi.useFakeTimers();
    installResizeObserver();
    localStorage.clear();
    window.history.replaceState(null, '', '/intel/');
    runtime.mobile = false;
    runtime.decode.mockReset();
    useUiPrefsStore.setState({ intelCardsExpanded: false, mobileDrawerSnapIndex: 0 });
    useUserRecordStore.setState({ activePoints: [], activeArchives: ['nar_auto'], updatedAt: 1 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fixture: SDK offline')));
    vi.stubGlobal('BroadcastChannel', class { onmessage = null; postMessage() {} close() {} });
});
afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState(null, '', '/'); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const mount = async () => { let view!: ReturnType<typeof render>; await flush(() => { view = render(<App />); }); return view; };
const cards = () => [...document.querySelectorAll<HTMLElement>('article[data-intel-archive]')];

it('combines categories and normalized title search, keeps collection buckets stable, and updates counts', async () => {
    await mount();
    expect(cards()).toHaveLength(archives.length);
    const uncollected = screen.getByRole('region', { name: /intel\.uncollected/ });
    const map = within(uncollected).getByRole('button', { name: /Ore report/ });
    fireEvent.click(map);
    expect(map.getAttribute('aria-pressed')).toBe('true');
    expect(useUserRecordStore.getState().activePoints).toContain('42');
    expect(uncollected.contains(map)).toBe(true);
    expect(screen.getByRole('heading', { name: /intel\.uncollected/ }).textContent).toContain(' - 1');
    fireEvent.click(screen.getByRole('button', { name: /category\.digital/ }));
    expect(cards().map((card) => card.dataset.intelArchive)).toEqual(['nar_mission']);
    const input = screen.getByPlaceholderText(translate('intel.search'));
    fireEvent.change(input, { target: { value: '  operation  ' } });
    expect(cards().map((card) => card.dataset.intelArchive)).toEqual(['nar_mission']);
    expect(screen.getByText('1 result')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'ORE REPORT' } });
    expect(screen.getByRole('status').textContent).toContain('intel.noResults');
    fireEvent.click(screen.getByRole('button', { name: /category\.digital/ }));
    expect(cards().map((card) => card.dataset.intelArchive)).toEqual(['nar_map']);
    fireEvent.click(screen.getByRole('button', { name: 'intel.showDetails' }));
    expect(document.querySelector('[data-app="intel"]')?.getAttribute('data-cards-expanded')).toBe('true');
});

it('expands the mobile drawer once per new nonblank search instead of stealing later drawer gestures', async () => {
    runtime.mobile = true;
    await mount();
    expect(useUiPrefsStore.getState().mobileDrawerSnapIndex).toBe(0);
    const input = screen.getByPlaceholderText(translate('intel.search'));
    fireEvent.change(input, { target: { value: '   ' } });
    expect(useUiPrefsStore.getState().mobileDrawerSnapIndex).toBe(0);
    fireEvent.change(input, { target: { value: 'ore' } });
    expect(useUiPrefsStore.getState().mobileDrawerSnapIndex).toBe(1);
    act(() => useUiPrefsStore.setState({ mobileDrawerSnapIndex: 2 }));
    fireEvent.change(input, { target: { value: 'ore report' } });
    expect(useUiPrefsStore.getState().mobileDrawerSnapIndex).toBe(2);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: 'ore' } });
    expect(useUiPrefsStore.getState().mobileDrawerSnapIndex).toBe(1);
});

it('waits for import completion, applies only named archives, then derives initial buckets and incomplete categories from imported state', async () => {
    const imported = deferred<{ payload: { collected: string[]; notCollected: string[] } }>();
    runtime.decode.mockReturnValue(imported.promise);
    window.history.replaceState(null, '', '/intel/?import=OEA-0-fixture&lang=en#keep');
    await mount();
    expect(cards()).toHaveLength(0);
    expect(screen.getByText('intel.importPending')).toBeTruthy();
    await flush(() => imported.resolve({ payload: { collected: ['nar_mission'], notCollected: ['nar_auto'] } }));
    expect(runtime.decode).toHaveBeenCalledWith('OEA-0-fixture', new Set(archives.map((archive) => archive.id)));
    expect(useUserRecordStore.getState().activeArchives).toEqual(['nar_mission']);
    expect(window.location.search).toBe('?lang=en');
    expect(window.location.hash).toBe('#keep');
    expect(screen.queryByRole('region', { name: /intel\.collected/ })).toBeNull();
    expect(screen.getByRole('button', { name: /category\.digital/ }).getAttribute('aria-pressed')).toBe('false');
    // Digital is complete, so import selects the remaining incomplete categories.
    expect(cards().map((card) => card.dataset.intelArchive)).not.toContain('nar_mission');
});

it('falls back to hydrated progress after a rejected import and leaves debug import URLs untouched', async () => {
    runtime.decode.mockRejectedValue(new Error('bad import'));
    window.history.replaceState(null, '', '/intel/i/OEA-0-fixture?lang=de');
    const view = await mount();
    expect(screen.getByText('intel.importError')).toBeTruthy();
    expect(cards()).toHaveLength(archives.length);
    expect(window.location.pathname).toBe('/intel/');
    expect(window.location.search).toBe('?lang=de');
    view.unmount();
    runtime.decode.mockClear();
    window.history.replaceState(null, '', '/intel/i/OEA-0-fixture/_debug');
    await mount();
    expect(runtime.decode).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/intel/i/OEA-0-fixture/_debug');
});

it.each(['resolve', 'reject'] as const)('ignores an import %s after the Intel page unmounts', async (result) => {
    const imported = deferred<{ payload: { collected: string[]; notCollected: string[] } }>();
    runtime.decode.mockReturnValue(imported.promise);
    window.history.replaceState(null, '', '/intel/?import=OEA-0-fixture');
    const view = await mount();
    const saved = useUserRecordStore.getState();
    view.unmount();
    window.history.replaceState(null, '', '/me/?import=keep#current');
    await flush(() => {
        if (result === 'resolve') imported.resolve({ payload: { collected: ['nar_mission'], notCollected: ['nar_auto'] } });
        else imported.reject(new Error('late import failure'));
    });
    expect(useUserRecordStore.getState()).toBe(saved);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/me/?import=keep#current');
});

it('builds import buckets from the latest progress when another tab edits unrelated archives during decoding', async () => {
    const imported = deferred<{ payload: { collected: string[]; notCollected: string[] } }>();
    runtime.decode.mockReturnValue(imported.promise);
    window.history.replaceState(null, '', '/intel/?import=OEA-0-fixture');
    await mount();
    act(() => { useUserRecordStore.setState({ activeArchives: ['nar_auto', 'nar_research'] }); });
    await flush(() => imported.resolve({ payload: { collected: ['nar_mission'], notCollected: ['nar_auto'] } }));
    expect(new Set(useUserRecordStore.getState().activeArchives)).toEqual(new Set(['nar_mission', 'nar_research']));
    // Import deliberately selects only incomplete categories. Re-admit the
    // externally completed report category before checking its bucket.
    fireEvent.click(screen.getByRole('button', { name: /category\.report/ }));
    const collected = screen.getByRole('region', { name: /intel\.collected/ });
    expect(within(collected).getByRole('button', { name: /Research notes/ }).getAttribute('aria-pressed')).toBe('true');
});

it('applies a pending import once under the real StrictMode entry lifecycle', async () => {
    const imported = deferred<{ payload: { collected: string[]; notCollected: string[] } }>();
    runtime.decode.mockReturnValue(imported.promise);
    window.history.replaceState(null, '', '/intel/?import=OEA-0-fixture');
    await flush(() => { render(<StrictMode><App /></StrictMode>); });
    await flush(() => imported.resolve({ payload: { collected: ['nar_mission'], notCollected: ['nar_auto'] } }));
    expect(runtime.decode).toHaveBeenCalledOnce();
    expect(useUserRecordStore.getState().activeArchives).toEqual(['nar_mission']);
    expect(window.location.search).toBe('');
    expect(screen.queryByText('intel.importPending')).toBeNull();
});

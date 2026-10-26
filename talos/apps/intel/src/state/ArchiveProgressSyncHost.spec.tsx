import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installResizeObserver } from '../../../../test-support/browser';
import { useAuthStore } from '@main/store/auth';
import { useUserRecordStore } from '@main/store/userRecord';
import { requestProgressSyncNow } from '@main/component/shared/sync/progressSyncController';
import { ProgressSyncError, type CloudArchiveProgress } from '@main/services/progress';
import { archives, deferred } from '../fixtures';
import ArchiveProgressSyncHost from './ArchiveProgressSyncHost';

const api = vi.hoisted(() => ({ fetch: vi.fn(), sync: vi.fn(), register: vi.fn(), index: vi.fn() }));
vi.mock('@main/services/progress', async (original) => ({
    ...await original<typeof import('@main/services/progress')>(),
    fetchCloudArchiveProgress: api.fetch, syncCloudArchiveProgress: api.sync, registerArchiveProgressManifest: api.register,
}));
vi.mock('./archiveProgress', async (original) => ({
    ...await original<typeof import('./archiveProgress')>(),
    getArchiveProgressIndex: api.index,
}));
vi.mock('@main/data/marker', () => ({ loadAllMarkers: () => Promise.resolve([]) }));
vi.mock('@main/locale', () => ({ useLocale: () => 'en-US', useTranslateUI: () => (key: string) => key, useTranslateGame: () => (key: string) => key }));
vi.mock('@main/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@intel/locale', () => ({ useTranslateUI: () => (key: string) => key }));

const progress = (archiveIds: string[] = [], revision = ''): CloudArchiveProgress => ({ revision, archiveIndexHash: 'index', archiveIds, updatedAt: 1 });
const settle = async (action: () => void = () => {}) => { await act(async () => { action(); for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
beforeEach(() => {
    vi.useFakeTimers();
    installResizeObserver();
    localStorage.clear();
    useAuthStore.setState({ sessionUser: { uid: 'u1', nickname: 'Reader' }, sessionVersion: 1 });
    useUserRecordStore.setState({ activePoints: ['42'], activeArchives: [], updatedAt: 1 });
    api.fetch.mockReset().mockResolvedValue({ progress: progress() });
    api.register.mockReset().mockResolvedValue(undefined);
    api.index.mockReset().mockResolvedValue({ archiveIndexHash: 'index', archiveIds: ['nar_mission', 'nar_auto', 'nar_shop', 'nar_research', 'nar_media'] });
    api.sync.mockReset().mockImplementation((payload: { setArchiveIds: string[] }) => Promise.resolve({ progress: progress(payload.setArchiveIds, 'r1') }));
});
afterEach(() => { cleanup(); localStorage.clear(); useAuthStore.setState({ sessionUser: null }); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('skips anonymous/offline startup and never sends map points to archive progress', async () => {
    useAuthStore.setState({ sessionUser: null });
    const view = render(<ArchiveProgressSyncHost />);
    await settle();
    expect(api.fetch).not.toHaveBeenCalled();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await settle(() => useAuthStore.setState({ sessionUser: { uid: 'u1', nickname: 'Reader' } }));
    expect(api.register).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    await settle(() => window.dispatchEvent(new Event('online')));
    expect(api.fetch).toHaveBeenCalledOnce();
    expect(api.sync).not.toHaveBeenCalled();
    view.unmount();
    await settle(() => window.dispatchEvent(new Event('online')));
    await requestProgressSyncNow();
    expect(api.fetch).toHaveBeenCalledOnce();
});

it('debounces local archive edits, submits a differential patch, and retains unknown IDs', async () => {
    await settle(() => { render(<ArchiveProgressSyncHost />); });
    await settle(() => useUserRecordStore.setState({ activeArchives: [archives[1].id, 'legacy'] }));
    await act(() => vi.advanceTimersByTime(1499));
    expect(api.sync).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTime(1));
    expect(api.sync).toHaveBeenCalledWith(expect.objectContaining({ baseRevision: '', archiveIndexHash: 'index', setArchiveIds: ['nar_mission', 'legacy'], clearArchiveIds: [] }), { keepalive: undefined });
    expect(localStorage.getItem('talos-archive-progress-pending-mutation:u1')).toBeNull();
    await settle(() => useUserRecordStore.setState({ activeArchives: ['legacy'] }));
    await act(() => vi.advanceTimersByTime(1500));
    expect(api.sync).toHaveBeenLastCalledWith(expect.objectContaining({ baseRevision: 'r1', setArchiveIds: ['legacy'], clearArchiveIds: ['nar_mission'] }), { keepalive: undefined });
    expect(useUserRecordStore.getState().activePoints).toEqual(['42']);
});

it.each(['a', 'b', 'merge'] as const)('resolves divergent archive histories with choice %s without discarding unknown local archives', async (choice) => {
    useUserRecordStore.setState({ activeArchives: ['nar_mission', 'legacy'] });
    api.fetch.mockResolvedValue({ progress: progress(['nar_auto'], 'remote') });
    await settle(() => { render(<ArchiveProgressSyncHost />); });
    expect(screen.getByRole('dialog', { name: 'sync.conflict.title' })).toBeTruthy();
    expect(api.sync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: choice === 'merge' ? 'sync.conflict.merge' : choice === 'a' ? 'sync.conflict.keepA' : 'sync.conflict.keepB' }));
    await settle();
    if (choice === 'b') {
        expect(useUserRecordStore.getState().activeArchives).toEqual(['nar_auto', 'legacy']);
        expect(api.sync).not.toHaveBeenCalled();
    } else {
        expect(api.sync).toHaveBeenCalledWith(expect.objectContaining({ baseRevision: 'remote', setArchiveIds: ['nar_mission'], clearArchiveIds: choice === 'a' ? ['nar_auto'] : [] }), { keepalive: undefined });
        if (choice === 'merge') expect(useUserRecordStore.getState().activeArchives).toEqual(['nar_mission', 'nar_auto', 'legacy']);
    }
    expect(useUserRecordStore.getState().activeArchives).toContain('legacy');
});

it('replays the same pending mutation after a transport failure, then submits edits made while it was pending', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await settle(() => { render(<ArchiveProgressSyncHost />); });
    // Establish an equal, trusted baseline first. A different account's empty
    // cloud is a conflict, while this account's subsequent edits auto-sync.
    api.sync.mockRejectedValueOnce(new Error('network lost'));
    await settle(() => useUserRecordStore.setState({ activeArchives: ['nar_mission'] }));
    await act(() => vi.advanceTimersByTime(1500));
    const pending = JSON.parse(localStorage.getItem('talos-archive-progress-pending-mutation:u1')!) as { payload: unknown };
    expect(warn).toHaveBeenCalledOnce();
    useUserRecordStore.setState({ activeArchives: ['nar_mission', 'nar_auto'] });
    await act(async () => { await requestProgressSyncNow(); });
    expect(api.sync.mock.calls[1][0]).toEqual(pending.payload);
    expect(api.sync.mock.calls[2][0]).toMatchObject({ baseRevision: 'r1', setArchiveIds: ['nar_auto'], clearArchiveIds: [] });
    expect(localStorage.getItem('talos-archive-progress-pending-mutation:u1')).toBeNull();
});

it('re-registers an evicted manifest once and reconciles a server acknowledgement without opening a spurious conflict', async () => {
    api.fetch.mockRejectedValueOnce(new ProgressSyncError('manifest missing', { status: 404, code: 'ARCHIVE_PROGRESS_MANIFEST_NOT_REGISTERED' })).mockResolvedValueOnce({ progress: progress() });
    await settle(() => { render(<ArchiveProgressSyncHost />); });
    expect(api.register).toHaveBeenCalledTimes(2);
    api.sync.mockRejectedValueOnce(new ProgressSyncError('conflict', { status: 409, code: 'REVISION_CONFLICT', details: { current: progress(['nar_mission'], 'ack') } }));
    await settle(() => useUserRecordStore.setState({ activeArchives: ['nar_mission'] }));
    await act(() => vi.advanceTimersByTime(1500));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('talos-archive-progress-pending-mutation:u1')).toBeNull();
    await act(async () => { await requestProgressSyncNow(); });
    expect(api.sync).toHaveBeenCalledOnce();
});

const emptySideConflicts = [
    { local: ['nar_mission'], cloud: [], side: 'new cloud empty' },
    { local: [], cloud: ['nar_auto'], side: 'local empty' },
].flatMap((source) => (['a', 'b', 'merge'] as const).map((choice) => ({ ...source, choice })));

it.each(emptySideConflicts)('requires a choice when $side after switching account and applies $choice through the real dialog', async ({ local, cloud, choice }) => {
    useUserRecordStore.setState({ activeArchives: local });
    api.fetch.mockResolvedValueOnce({ progress: progress(local, 'old-account') });
    await settle(() => { render(<ArchiveProgressSyncHost />); });
    expect(api.sync).not.toHaveBeenCalled();
    api.fetch.mockResolvedValue({ progress: progress(cloud, cloud.length ? 'new-account' : '') });
    await settle(() => useAuthStore.setState({ sessionUser: { uid: 'u2', nickname: 'Next reader' }, sessionVersion: 2 }));
    expect(screen.getByRole('dialog', { name: 'sync.conflict.title' })).toBeTruthy();
    expect(useUserRecordStore.getState().activeArchives).toEqual(local);
    expect(api.sync).not.toHaveBeenCalled();
    const label = choice === 'merge' ? 'sync.conflict.merge' : choice === 'a' ? 'sync.conflict.keepA' : 'sync.conflict.keepB';
    fireEvent.click(screen.getByRole('button', { name: label }));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    const expected = choice === 'a' ? local : choice === 'b' ? cloud : [...new Set([...local, ...cloud])];
    expect(new Set(useUserRecordStore.getState().activeArchives)).toEqual(new Set(expected));
    if (choice === 'b' || (choice === 'merge' && !local.length)) expect(api.sync).not.toHaveBeenCalled();
    else {
        expect(api.sync).toHaveBeenCalledOnce();
        expect(api.sync.mock.calls[0][0]).toMatchObject({
            baseRevision: cloud.length ? 'new-account' : '',
            setArchiveIds: local,
            clearArchiveIds: choice === 'a' ? cloud : [],
        });
    }
});

it('starts the next account sync immediately and ignores the previous account response', async () => {
    const previous = deferred<{ progress: CloudArchiveProgress }>();
    api.fetch.mockReturnValueOnce(previous.promise).mockResolvedValue({ progress: progress() });
    await settle(() => { render(<ArchiveProgressSyncHost />); });
    await settle(() => useAuthStore.setState({ sessionUser: { uid: 'u2', nickname: 'Next reader' } }));
    expect(api.fetch).toHaveBeenCalledTimes(2);
    await settle(() => previous.resolve({ progress: progress(['nar_auto'], 'old-user') }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.fetch).toHaveBeenCalledTimes(2);
    expect(api.sync).not.toHaveBeenCalled();
});

it('does not begin startup sync after its hydration resolves following unmount', async () => {
    const hydrated = deferred<void>();
    vi.spyOn(useUserRecordStore.persist, 'rehydrate').mockReturnValueOnce(hydrated.promise);
    const view = render(<ArchiveProgressSyncHost />);
    view.unmount();
    await settle(() => hydrated.resolve());
    expect(api.index).not.toHaveBeenCalled();
    expect(api.fetch).not.toHaveBeenCalled();
});

it('does not register a manifest after its index load resolves following unmount', async () => {
    const index = deferred<{ archiveIndexHash: string; archiveIds: string[] }>();
    api.index.mockReturnValueOnce(index.promise);
    const view = render(<ArchiveProgressSyncHost />);
    await settle();
    expect(api.index).toHaveBeenCalledOnce();
    view.unmount();
    await settle(() => index.resolve({ archiveIndexHash: 'index', archiveIds: [] }));
    expect(api.register).not.toHaveBeenCalled();
    expect(api.fetch).not.toHaveBeenCalled();
});

it.each(['same account signs in again', 'A to B to A'] as const)('starts the new archive session and rejects the late response when %s', async (transition) => {
    const old = deferred<{ progress: CloudArchiveProgress }>();
    api.fetch.mockReturnValueOnce(old.promise);
    await settle(() => { render(<ArchiveProgressSyncHost />); });
    expect(api.fetch).toHaveBeenCalledOnce();
    if (transition === 'A to B to A') {
        await settle(() => useAuthStore.setState({ sessionUser: { uid: 'u2', nickname: 'Next reader' }, sessionVersion: 2 }));
        expect(api.fetch).toHaveBeenCalledTimes(2);
    }
    await settle(() => useAuthStore.setState({ sessionUser: { uid: 'u1', nickname: 'Reader again' }, sessionVersion: 3 }));
    expect(api.fetch).toHaveBeenCalledTimes(transition === 'A to B to A' ? 3 : 2);
    await settle(() => old.resolve({ progress: progress(['nar_auto'], 'stale') }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.sync).not.toHaveBeenCalled();
    expect(useUserRecordStore.getState().activeArchives).toEqual([]);
});

it('does not re-register after an obsolete missing-manifest response arrives', async () => {
    const old = deferred<{ progress: CloudArchiveProgress }>();
    api.fetch.mockReturnValueOnce(old.promise);
    await settle(() => { render(<ArchiveProgressSyncHost />); });
    expect(api.register).toHaveBeenCalledOnce();
    await settle(() => useAuthStore.setState({ sessionUser: null, sessionVersion: 2 }));
    await settle(() => old.reject(new ProgressSyncError('missing', { status: 404, code: 'ARCHIVE_PROGRESS_MANIFEST_NOT_REGISTERED' })));
    expect(api.register).toHaveBeenCalledOnce();
    expect(api.fetch).toHaveBeenCalledOnce();
});

it('does not replay after a manifest registration completes in a later session', async () => {
    const registered = deferred<void>();
    api.register.mockResolvedValueOnce(undefined).mockReturnValueOnce(registered.promise);
    api.fetch.mockRejectedValueOnce(new ProgressSyncError('missing', { status: 404, code: 'ARCHIVE_PROGRESS_MANIFEST_NOT_REGISTERED' }));
    await settle(() => { render(<ArchiveProgressSyncHost />); });
    expect(api.register).toHaveBeenCalledTimes(2);
    await settle(() => useAuthStore.setState({ sessionUser: null, sessionVersion: 2 }));
    await settle(() => registered.resolve());
    expect(api.fetch).toHaveBeenCalledOnce();
});

it('does not let an old completion release the current session request lock', async () => {
    const old = deferred<{ progress: CloudArchiveProgress }>();
    const current = deferred<{ progress: CloudArchiveProgress }>();
    api.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await settle(() => { render(<ArchiveProgressSyncHost />); });
    await settle(() => useAuthStore.setState({ sessionUser: { uid: 'u1', nickname: 'Again' }, sessionVersion: 2 }));
    expect(api.fetch).toHaveBeenCalledTimes(2);
    await settle(() => old.resolve({ progress: progress(['nar_auto'], 'stale') }));
    await act(async () => { await requestProgressSyncNow(); });
    expect(api.fetch).toHaveBeenCalledTimes(2);
    await settle(() => current.resolve({ progress: progress() }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.fetch).toHaveBeenCalledTimes(2);
});

it('leaves an unacknowledged archive mutation persisted when its write finishes after unmount', async () => {
    const view = render(<ArchiveProgressSyncHost />);
    await settle();
    const response = deferred<{ progress: CloudArchiveProgress }>();
    api.sync.mockReturnValueOnce(response.promise);
    await settle(() => useUserRecordStore.setState({ activeArchives: ['nar_mission'], updatedAt: 2 }));
    let pending!: Promise<void>;
    await settle(() => { pending = requestProgressSyncNow(); });
    expect(api.sync).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => { response.resolve({ progress: progress(['nar_mission'], 'late') }); await pending; });
    expect(localStorage.getItem('talos-archive-progress-pending-mutation:u1')).not.toBeNull();
    expect(api.sync).toHaveBeenCalledOnce();
});

import { createElement } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/services/auth/types';
import { ProgressSyncError, type ProgressSyncRequestPayload } from '@/services/progress/syncClient';
import { areLocalPointsSynced } from '@/services/progress/pointState';
import { useAuthStore } from '@/store/auth';
import { useUserRecordStore } from '@/store/userRecord';
import { useProgressSyncStore, type CloudProgress } from '@/store/progressSync';
import { requestProgressSyncNow } from '@/component/shared/sync/progressSyncController';
import ProgressSyncHost from '@/component/shared/sync/ProgressSyncHost';

const api = vi.hoisted(() => ({ manifest: vi.fn(), markerIndex: vi.fn(), register: vi.fn(), fetch: vi.fn(), sync: vi.fn() }));
vi.mock('@/services/progress', async () => ({
    ProgressSyncError: (await import('@/services/progress/syncClient')).ProgressSyncError,
    getProgressManifestPayload: api.manifest,
    getProgressMarkerIndex: api.markerIndex,
    registerProgressManifest: api.register,
    fetchCloudProgress: api.fetch,
    syncCloudProgress: api.sync,
}));
vi.mock('@/component/shared/sync/conflict', () => ({ default: () => null }));
vi.mock('@/store/auth', async () => {
    const { create } = await import('zustand');
    return { useAuthStore: create(() => ({ sessionUser: null as SessionUser | null })) };
});
vi.mock('@/store/userRecord', async () => {
    const { create } = await import('zustand');
    return { useUserRecordStore: create(() => ({ activePoints: [] as string[], updatedAt: 1 })) };
});
vi.mock('@/store/history', async () => {
    const { useUserRecordStore: store } = await import('@/store/userRecord');
    return {
        replacePointProgressFromExternal: (activePoints: string[]) => {
            store.setState({ activePoints, updatedAt: store.getState().updatedAt + 1 });
        },
    };
});

const markerIndexHash = 'a'.repeat(64);
const remote: CloudProgress = {
    revision: 'b'.repeat(64), markerIndexHash, updatedAt: 1,
    pointIds: ['p1'], retainedPointIds: ['legacy'],
};

const isAlreadySynced = (): boolean => {
    const state = useProgressSyncStore.getState();
    return state.status === 'synced' && areLocalPointsSynced(useUserRecordStore.getState().activePoints, state.baseline);
};

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    useAuthStore.setState({ sessionUser: { uid: 'viewer', nickname: 'Viewer' } });
    useUserRecordStore.setState({ activePoints: ['p1', 'legacy'], updatedAt: 1 });
    useProgressSyncStore.setState({
        status: 'idle', baseline: null, lastSyncedAt: null, error: null,
        localPointCount: 0, remotePointCount: 0, conflict: null,
    });
    api.manifest.mockResolvedValue({ markerIndexHash, pointIds: ['p1', 'p2'] });
    api.markerIndex.mockResolvedValue({ markerIndexHash, pointIds: ['p1', 'p2'] });
    api.register.mockResolvedValue({ ok: true });
    api.fetch.mockResolvedValue({ progress: remote });
    api.sync.mockImplementation((payload: ProgressSyncRequestPayload) => Promise.resolve({
        ok: true,
        progress: {
            revision: 'c'.repeat(64), markerIndexHash, updatedAt: payload.updatedAt,
            retainedPointIds: ['legacy', ...payload.setPointIds.filter((pointId) => !['p1', 'p2'].includes(pointId))],
        },
    }));
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('progress synchronization acknowledgement', () => {
    it('shows already synced for acknowledged legacy points without repeated manual or lifecycle writes', async () => {
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        await act(async () => {
            await requestProgressSyncNow();
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('online'));
        });
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        expect(api.sync).not.toHaveBeenCalled();
        expect(useUserRecordStore.getState().activePoints).toContain('legacy');
    });

    it('uploads a new legacy point once, preserves it locally, and does not resend after remount', async () => {
        useUserRecordStore.setState({ activePoints: ['p1', 'legacy', 'legacy-new'] });
        const view = render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        expect(api.sync).toHaveBeenCalledOnce();
        expect(api.sync).toHaveBeenCalledWith(expect.objectContaining({
            setPointIds: ['legacy-new'], clearPointIds: [],
        }), expect.anything());
        await act(() => requestProgressSyncNow());
        expect(api.sync).toHaveBeenCalledOnce();
        view.unmount();
        api.fetch.mockResolvedValue({ progress: { ...remote, retainedPointIds: ['legacy', 'legacy-new'] } });
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        expect(api.sync).toHaveBeenCalledOnce();
        expect(useUserRecordStore.getState().activePoints).toEqual(['p1', 'legacy', 'legacy-new']);
    });

    it('keeps unacknowledged legacy points dirty after failure and retries the original mutation', async () => {
        useUserRecordStore.setState({ activePoints: ['p1', 'legacy-new'] });
        api.sync.mockRejectedValueOnce(new Error('temporary failure'));
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(useProgressSyncStore.getState().status).toBe('error'));
        expect(isAlreadySynced()).toBe(false);
        const firstPayload = api.sync.mock.calls[0]?.[0] as ProgressSyncRequestPayload;
        await act(() => requestProgressSyncNow());
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        expect(api.sync).toHaveBeenCalledTimes(2);
        expect(api.sync.mock.calls[1]?.[0]).toEqual(firstPayload);
        await act(() => requestProgressSyncNow());
        expect(api.sync).toHaveBeenCalledTimes(2);
    });

    it('immediately becomes synced again after undoing a local change, without a no-op request', async () => {
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        vi.useFakeTimers();
        act(() => useUserRecordStore.setState({ activePoints: ['p1', 'p2', 'legacy'], updatedAt: 2 }));
        expect(useProgressSyncStore.getState().status).toBe('dirty');
        act(() => useUserRecordStore.setState({ activePoints: ['p1', 'legacy'], updatedAt: 3 }));
        expect(isAlreadySynced()).toBe(true);
        await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
        expect(api.sync).not.toHaveBeenCalled();
    });

    it('detects actual point changes even if their timestamps match', async () => {
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        act(() => useUserRecordStore.setState({ activePoints: ['p1', 'p2', 'legacy'] }));
        expect(useProgressSyncStore.getState().status).toBe('dirty');
        await act(() => requestProgressSyncNow());
        expect(api.sync).toHaveBeenCalledWith(expect.objectContaining({ setPointIds: ['p2'] }), expect.anything());
        expect(isAlreadySynced()).toBe(true);
    });

    it('accepts a matching 409 snapshot without an endless retry of already-retained IDs', async () => {
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        act(() => useUserRecordStore.setState({ activePoints: ['p1', 'p2', 'legacy'], updatedAt: 2 }));
        api.sync.mockRejectedValueOnce(new ProgressSyncError('stale revision', {
            status: 409, code: 'PROGRESS_REVISION_CONFLICT',
            current: { ...remote, pointIds: ['p1', 'p2'] },
        }));
        await act(() => requestProgressSyncNow());
        expect(isAlreadySynced()).toBe(true);
        expect(api.sync).toHaveBeenCalledOnce();
        expect(useProgressSyncStore.getState().conflict).toBeNull();
    });

    it('preserves compatibility with a successful older server response that omits retained IDs', async () => {
        useUserRecordStore.setState({ activePoints: ['p1', 'legacy-new'] });
        api.fetch.mockResolvedValue({ progress: { ...remote, retainedPointIds: undefined } });
        api.sync.mockResolvedValue({ ok: true, progress: { ...remote, retainedPointIds: undefined } });
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        await act(() => requestProgressSyncNow());
        expect(api.sync).toHaveBeenCalledOnce();
    });

    it('does not mark a legacy point added during an in-flight request as already acknowledged', async () => {
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        let resolveFirst!: (value: { ok: true; progress: CloudProgress }) => void;
        let resolveSecond!: (value: { ok: true; progress: CloudProgress }) => void;
        api.sync.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
        api.sync.mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
        act(() => useUserRecordStore.setState({ activePoints: ['p1', 'p2', 'legacy'], updatedAt: 2 }));
        let firstSync: Promise<void> = Promise.resolve();
        await act(async () => {
            firstSync = requestProgressSyncNow();
            await Promise.resolve();
        });
        await waitFor(() => expect(api.sync).toHaveBeenCalledOnce());
        act(() => useUserRecordStore.setState({ activePoints: ['p1', 'p2', 'legacy', 'legacy-new'], updatedAt: 3 }));
        await act(async () => {
            resolveFirst({ ok: true, progress: { ...remote, pointIds: ['p1', 'p2'] } });
            await firstSync;
        });
        await waitFor(() => expect(api.sync).toHaveBeenCalledTimes(2));
        expect(isAlreadySynced()).toBe(false);
        expect(api.sync.mock.calls[1]?.[0]).toMatchObject({ setPointIds: ['legacy-new'], clearPointIds: [] });
        await act(async () => {
            resolveSecond({
                ok: true, progress: { ...remote, pointIds: ['p1', 'p2'], retainedPointIds: ['legacy', 'legacy-new'] },
            });
            await Promise.resolve();
        });
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
    });

    it('retries genuinely unacknowledged legacy points after a matching visible 409 snapshot', async () => {
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        act(() => useUserRecordStore.setState({ activePoints: ['p1', 'legacy', 'legacy-new'], updatedAt: 2 }));
        const current = { ...remote, revision: 'd'.repeat(64) };
        api.sync.mockRejectedValueOnce(new ProgressSyncError('stale revision', {
            status: 409, code: 'PROGRESS_REVISION_CONFLICT', current,
        }));
        await act(() => requestProgressSyncNow());
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        expect(api.sync).toHaveBeenCalledTimes(2);
        expect(api.sync.mock.calls[1]?.[0]).toMatchObject({
            baseRevision: current.revision, setPointIds: ['legacy-new'], clearPointIds: [],
        });
    });

    it('does not upload duplicate or whitespace-only differences', async () => {
        useUserRecordStore.setState({ activePoints: [' legacy ', ' p1 ', 'p1', ''] });
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        await act(() => requestProgressSyncNow());
        expect(api.sync).not.toHaveBeenCalled();
    });

    it('aligns an old manifest once even if all visible and retained points are already acknowledged', async () => {
        api.fetch.mockResolvedValue({ progress: { ...remote, markerIndexHash: 'e'.repeat(64) } });
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        expect(api.sync).toHaveBeenCalledOnce();
        expect(api.sync.mock.calls[0]?.[0]).toMatchObject({ markerIndexHash, setPointIds: [], clearPointIds: [] });
        await act(() => requestProgressSyncNow());
        expect(api.sync).toHaveBeenCalledOnce();
    });

    it('keeps genuine visible progress conflicts unresolved rather than claiming a legacy-only mismatch', async () => {
        api.fetch.mockResolvedValue({ progress: { ...remote, pointIds: ['p2'] } });
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(useProgressSyncStore.getState().status).toBe('conflict'));
        expect(isAlreadySynced()).toBe(false);
        expect(useProgressSyncStore.getState().conflict).toMatchObject({
            localPointIds: ['p1'], remotePointIds: ['p2'],
        });
        expect(api.sync).not.toHaveBeenCalled();
        expect(useUserRecordStore.getState().activePoints).toEqual(['p1', 'legacy']);
    });
});

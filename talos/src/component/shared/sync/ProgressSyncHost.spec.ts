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
    return { useAuthStore: create(() => ({ sessionUser: null as SessionUser | null, sessionVersion: 0 })) };
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
    useAuthStore.setState({ sessionUser: { uid: 'viewer', nickname: 'Viewer' }, sessionVersion: 1 });
    useUserRecordStore.setState({ activePoints: ['p1', 'legacy'], updatedAt: 1 });
    useProgressSyncStore.setState({
        status: 'idle', baseline: null, baselineUid: null, lastSyncedAt: null, error: null,
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

    it('does no cloud work for a signed-out user, including manual and lifecycle requests', async () => {
        useAuthStore.setState({ sessionUser: null });
        render(createElement(ProgressSyncHost));
        await act(async () => {
            await requestProgressSyncNow();
            window.dispatchEvent(new Event('online'));
            window.dispatchEvent(new Event('pagehide'));
        });
        expect(api.manifest).not.toHaveBeenCalled();
        expect(api.fetch).not.toHaveBeenCalled();
        expect(api.sync).not.toHaveBeenCalled();
    });

    it('does not apply a startup response belonging to an account that has signed out', async () => {
        let finish!: (value: { progress: CloudProgress }) => void;
        api.fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(api.fetch).toHaveBeenCalledOnce());
        act(() => useAuthStore.setState({ sessionUser: null }));
        await act(async () => { finish({ progress: { ...remote, pointIds: ['p2'] } }); await Promise.resolve(); });
        expect(useProgressSyncStore.getState().conflict).toBeNull();
        expect(useProgressSyncStore.getState().baseline).toBeNull();
        expect(useUserRecordStore.getState().activePoints).toEqual(['p1', 'legacy']);
    });

    it('does not apply a startup response after its host unmounts', async () => {
        let finish!: (value: { progress: CloudProgress }) => void;
        api.fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        const view = render(createElement(ProgressSyncHost));
        await waitFor(() => expect(api.fetch).toHaveBeenCalledOnce());
        view.unmount();
        await act(async () => { finish({ progress: { ...remote, pointIds: ['p2'] } }); await Promise.resolve(); });
        expect(useProgressSyncStore.getState().conflict).toBeNull();
        expect(useProgressSyncStore.getState().baseline).toBeNull();
        expect(api.sync).not.toHaveBeenCalled();
    });

    it.each(['same account signs in again', 'A to B to A'] as const)('rejects a stale response when %s while starting the new session immediately', async (transition) => {
        let finish!: (value: { progress: CloudProgress }) => void;
        api.fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(api.fetch).toHaveBeenCalledOnce());
        if (transition === 'A to B to A') {
            act(() => useAuthStore.setState({ sessionUser: { uid: 'another', nickname: 'Another' }, sessionVersion: 2 }));
            await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
        }
        act(() => useAuthStore.setState({ sessionUser: { uid: 'viewer', nickname: 'Viewer again' }, sessionVersion: 3 }));
        await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(transition === 'A to B to A' ? 3 : 2));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        await act(async () => { finish({ progress: { ...remote, revision: 'stale', pointIds: ['p2'] } }); await Promise.resolve(); });
        expect(useProgressSyncStore.getState().conflict).toBeNull();
        expect(useProgressSyncStore.getState().baseline?.revision).toBe(remote.revision);
        expect(useUserRecordStore.getState().activePoints).toEqual(['p1', 'legacy']);
        expect(api.sync).not.toHaveBeenCalled();
    });

    it('does not register or replay an obsolete manifest after a late missing-manifest response', async () => {
        let fail!: (reason: unknown) => void;
        api.fetch.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(api.fetch).toHaveBeenCalledOnce());
        expect(api.register).toHaveBeenCalledOnce();
        act(() => useAuthStore.setState({ sessionUser: null, sessionVersion: 2 }));
        await act(async () => { fail(new ProgressSyncError('missing', { code: 'PROGRESS_MANIFEST_NOT_REGISTERED', status: 409 })); await Promise.resolve(); });
        expect(api.register).toHaveBeenCalledOnce();
        expect(api.fetch).toHaveBeenCalledOnce();
        expect(useProgressSyncStore.getState().baseline).toBeNull();
    });

    it('does not replay a request after its manifest re-registration finishes in a later session', async () => {
        let finish!: (value: { ok: true }) => void;
        api.register.mockResolvedValueOnce({ ok: true }).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        api.fetch.mockRejectedValueOnce(new ProgressSyncError('missing', { code: 'PROGRESS_MANIFEST_NOT_REGISTERED', status: 409 }));
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(api.register).toHaveBeenCalledTimes(2));
        act(() => useAuthStore.setState({ sessionUser: null, sessionVersion: 2 }));
        await act(async () => { finish({ ok: true }); await Promise.resolve(); });
        expect(api.fetch).toHaveBeenCalledOnce();
        expect(useProgressSyncStore.getState().baseline).toBeNull();
    });

    it('does not release the new session request lock when the old response finally arrives', async () => {
        let finishOld!: (value: { progress: CloudProgress }) => void;
        let finishNew!: (value: { progress: CloudProgress }) => void;
        api.fetch.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
            .mockReturnValueOnce(new Promise((resolve) => { finishNew = resolve; }));
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(api.fetch).toHaveBeenCalledOnce());
        act(() => useAuthStore.setState({ sessionUser: { uid: 'viewer', nickname: 'Again' }, sessionVersion: 2 }));
        await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
        await act(async () => { finishOld({ progress: { ...remote, pointIds: ['p2'] } }); await Promise.resolve(); });
        await act(() => requestProgressSyncNow());
        expect(api.fetch).toHaveBeenCalledTimes(2);
        await act(async () => { finishNew({ progress: remote }); await Promise.resolve(); });
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        expect(api.fetch).toHaveBeenCalledTimes(2);
        expect(api.sync).not.toHaveBeenCalled();
    });

    it('preserves the pending mutation for replay instead of acknowledging a write after unmount', async () => {
        const view = render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        let finish!: (value: { ok: true; progress: CloudProgress }) => void;
        api.sync.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        act(() => useUserRecordStore.setState({ activePoints: ['p1', 'p2', 'legacy'], updatedAt: 2 }));
        let pending!: Promise<void>;
        await act(async () => { pending = requestProgressSyncNow(); await Promise.resolve(); });
        await waitFor(() => expect(api.sync).toHaveBeenCalledOnce());
        view.unmount();
        await act(async () => { finish({ ok: true, progress: { ...remote, revision: 'late', pointIds: ['p1', 'p2'] } }); await pending; });
        expect(useProgressSyncStore.getState().baseline?.revision).toBe(remote.revision);
        expect(localStorage.getItem('talos-progress-pending-mutation:viewer')).not.toBeNull();
        expect(api.sync).toHaveBeenCalledOnce();
    });

    it('cleans up a pending automatic upload and lifecycle listeners on unmount', async () => {
        const view = render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        vi.useFakeTimers();
        act(() => useUserRecordStore.setState({ activePoints: ['p1', 'p2', 'legacy'], updatedAt: 2 }));
        expect(useProgressSyncStore.getState().status).toBe('dirty');
        view.unmount();
        expect(vi.getTimerCount()).toBe(0);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(65_000);
            await requestProgressSyncNow();
            window.dispatchEvent(new Event('online'));
            window.dispatchEvent(new Event('pagehide'));
        });
        expect(api.sync).not.toHaveBeenCalled();
    });

    it('keeps local progress after an offline failure and retries on the online event', async () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        api.fetch.mockRejectedValueOnce(new Error('offline'));
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(useProgressSyncStore.getState().status).toBe('offline'));
        expect(useUserRecordStore.getState().activePoints).toEqual(['p1', 'legacy']);
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        act(() => { window.dispatchEvent(new Event('online')); });
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        expect(useUserRecordStore.getState().activePoints).toEqual(['p1', 'legacy']);
    });

    it('asks for a choice when a newly signed-in account differs from local progress instead of using the previous account baseline', async () => {
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        api.fetch.mockResolvedValue({ progress: { ...remote, pointIds: ['p2'] } });
        act(() => useAuthStore.setState({ sessionUser: { uid: 'second-user', nickname: 'Another' } }));
        await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
        expect(useUserRecordStore.getState().activePoints).toEqual(['p1', 'legacy']);
        expect(useProgressSyncStore.getState().conflict).toMatchObject({ localPointIds: ['p1'], remotePointIds: ['p2'] });
        expect(api.sync).not.toHaveBeenCalled();
    });

    it.each([{ pointIds: [] }, { pointIds: ['p2'] }])('requires a choice for an unowned legacy baseline when remote progress is $pointIds', async ({ pointIds }) => {
        useProgressSyncStore.setState({ baseline: remote, baselineUid: null });
        api.fetch.mockResolvedValue({ progress: { ...remote, revision: pointIds.length ? remote.revision : '', pointIds } });
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(useProgressSyncStore.getState().status).toBe('conflict'));
        expect(useProgressSyncStore.getState().conflict).toMatchObject({ localPointIds: ['p1'], remotePointIds: pointIds });
        expect(useUserRecordStore.getState().activePoints).toEqual(['p1', 'legacy']);
        expect(api.sync).not.toHaveBeenCalled();
    });

    it('can adopt newer remote progress on the same account when its owned baseline still matches local progress', async () => {
        useProgressSyncStore.setState({ baseline: remote, baselineUid: 'viewer' });
        api.fetch.mockResolvedValue({ progress: { ...remote, pointIds: ['p2'] } });
        render(createElement(ProgressSyncHost));
        await waitFor(() => expect(isAlreadySynced()).toBe(true));
        expect(useProgressSyncStore.getState().conflict).toBeNull();
        expect(useUserRecordStore.getState().activePoints).toEqual(['p2', 'legacy']);
        expect(api.sync).not.toHaveBeenCalled();
    });
});

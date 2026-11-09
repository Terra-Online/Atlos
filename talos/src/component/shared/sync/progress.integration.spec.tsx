import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProgressSyncHost from './ProgressSyncHost';
import { useAuthStore } from '@/store/auth';
import { useUserRecordStore } from '@/store/userRecord';
import { useProgressSyncStore, type CloudProgress } from '@/store/progressSync';
import { type ProgressSyncRequestPayload } from '@/services/progress/syncClient';
import { translate as t } from '../testFixtures';
import { installResizeObserver } from '../../../../test-support/browser';

const api = vi.hoisted(() => ({ fetch: vi.fn(), sync: vi.fn() }));
vi.mock('@/services/progress', async (original) => ({
    ...await original<typeof import('@/services/progress')>(),
    getProgressMarkerIndex: () => Promise.resolve({ markerIndexHash: 'hash', pointIds: ['p1', 'p2'] }),
    getProgressManifestPayload: () => Promise.resolve({ markerIndexHash: 'hash', pointIds: ['p1', 'p2'] }),
    registerProgressManifest: () => Promise.resolve({ ok: true }),
    fetchCloudProgress: api.fetch, syncCloudProgress: api.sync,
}));
vi.mock('@/locale', async () => (await import('../testFixtures')).localeFixture);
vi.mock('@/locale/useFontRegion', async () => {
    const { fontRef } = await import('../testFixtures');
    return { useFontRegion: () => fontRef };
});
vi.mock('@/platform/pictureInPicture', async () => (await import('../testFixtures')).pipFixture);
vi.mock('@/data/marker', async (original) => ({
    ...await original<typeof import('@/data/marker')>(), loadAllMarkers: () => Promise.resolve([]),
}));

const remote: CloudProgress = { revision: 'new-account-rev', markerIndexHash: 'hash', pointIds: ['p2'], retainedPointIds: ['legacy'], updatedAt: 1 };
beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); installResizeObserver();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    useAuthStore.getState().setSessionUser({ uid: 'new-account', nickname: 'New account' });
    useUserRecordStore.setState({ activePoints: ['p1', 'legacy'] });
    useProgressSyncStore.setState(useProgressSyncStore.getInitialState(), true);
    useProgressSyncStore.getState().setBaseline({ ...remote, pointIds: ['p1'] }, 'old-account');
    api.fetch.mockResolvedValue({ progress: remote });
    api.sync.mockImplementation((payload: ProgressSyncRequestPayload) => Promise.resolve({ ok: true, progress: { ...remote, revision: 'chosen-rev', updatedAt: payload.updatedAt } }));
});
afterEach(() => { cleanup(); useAuthStore.getState().clearSessionUser(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([
    { choice: 'a', label: t('sync.conflict.keepA').replace('{label}', t('sync.conflict.local')), expected: ['p1', 'legacy'] },
    { choice: 'b', label: t('sync.conflict.keepB').replace('{label}', t('sync.conflict.remote')), expected: ['p2', 'legacy'] },
    { choice: 'merge', label: t('sync.conflict.merge').replace('{count}', '2'), expected: ['p1', 'p2', 'legacy'] },
])('lets the user resolve a cross-account conflict by choosing $choice through the real dialog', async ({ choice, label, expected }) => {
    render(<ProgressSyncHost />);
    await waitFor(() => expect(screen.getByRole('dialog', { name: t('sync.conflict.title') })).toBeTruthy());
    expect(useUserRecordStore.getState().activePoints).toEqual(['p1', 'legacy']);
    expect(api.sync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(useProgressSyncStore.getState().status).toBe('synced'));
    expect(new Set(useUserRecordStore.getState().activePoints)).toEqual(new Set(expected));
    expect(useProgressSyncStore.getState().conflict).toBeNull();
    expect(useProgressSyncStore.getState().baselineUid).toBe('new-account');
    if (choice === 'b') expect(api.sync).not.toHaveBeenCalled();
    else {
        expect(api.sync).toHaveBeenCalledOnce();
        expect(api.sync.mock.calls[0][0]).toMatchObject({
            baseRevision: remote.revision,
            setPointIds: ['p1'],
            clearPointIds: choice === 'a' ? ['p2'] : [],
        });
    }
    await act(async () => {});
});

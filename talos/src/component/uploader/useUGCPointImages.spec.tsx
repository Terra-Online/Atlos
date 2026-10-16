import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMarkerData } from '@/data/marker';
import useUGCPointImages from './useUGCPointImages';
const state = vi.hoisted(() => ({
    user: { uid: 'a' } as { uid: string } | null,
    request: null as { markerId: string; imageId: string } | null,
    detail: vi.fn(), public: vi.fn(), byId: vi.fn(), clear: vi.fn(),
}));
vi.mock('@/store/auth', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ sessionUser: state.user }) }));
vi.mock('@/store/marker', () => ({ useMarkerStore: (select: (s: unknown) => unknown) => select({ imageOpenRequest: state.request, clearImageOpenRequest: state.clear }) }));
vi.mock('@/services/ugc/client', () => ({
    listUGCPointImages: state.detail, listPublicUGCImages: state.public, getUGCImageById: state.byId,
    resolveUGCUploadTarget: (point: unknown) => point,
}));
const point = { id: 'm', type: 'test' } as IMarkerData;
beforeEach(() => {
    vi.resetAllMocks(); state.user = { uid: 'a' }; state.request = null;
    state.detail.mockResolvedValue({ images: [], myImages: [{ id: 'pending', markerId: 'm', status: 'pending_audit' }] });
    state.public.mockResolvedValue([]);
});
describe('detail image demand', () => {
    it('loads pending images only when detail becomes visible, without refetching on profile updates', async () => {
        const { result, rerender } = renderHook(({ enabled }) => useUGCPointImages(point, enabled), { initialProps: { enabled: false } });
        expect(state.detail).not.toHaveBeenCalled();
        rerender({ enabled: true });
        await waitFor(() => expect(result.current.pendingOwn?.id).toBe('pending'));
        expect(state.detail).toHaveBeenCalledTimes(1);
        state.user = { uid: 'a' };
        rerender({ enabled: true });
        expect(state.detail).toHaveBeenCalledTimes(1);
        state.user = null;
        rerender({ enabled: true });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.myImages).toEqual([]);
        expect(state.public).toHaveBeenCalledTimes(1);
    });
    it('discards late results after switching points or accounts', async () => {
        let resolve!: (value: unknown) => void;
        state.detail.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
        const { result, rerender } = renderHook(({ marker }) => useUGCPointImages(marker, true), { initialProps: { marker: point } });
        state.user = { uid: 'b' };
        state.detail.mockResolvedValue({ images: [], myImages: [] });
        rerender({ marker: { ...point, id: 'next' } });
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { resolve({ images: [], myImages: [{ id: 'secret', markerId: 'm' }] }); await Promise.resolve(); });
        expect(result.current.myImages).toEqual([]);
    });
    it('keeps a shared image opened during the detail entrance transition', async () => {
        state.request = { markerId: 'm', imageId: 'shared' };
        state.byId.mockResolvedValue({ id: 'shared', markerId: 'm' });
        const { result, rerender } = renderHook(({ enabled }) => useUGCPointImages(point, enabled), { initialProps: { enabled: false } });
        await waitFor(() => expect(result.current.viewerOpen).toBe(true));
        rerender({ enabled: true });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.viewerOpen).toBe(true);
        expect(result.current.activeImages.some((image) => image.id === 'shared')).toBe(true);
    });
});

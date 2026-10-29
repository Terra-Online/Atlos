import { useRef, useState } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { IMarkerData } from '@/data/marker';
import { useAuthStore } from '@/store/auth';
import type { UGCUploadSubmission } from '@/services/ugc/client';
import useUGCPointImages from './useUGCPointImages';
import useUGCImageActions from './useUGCImageActions';
vi.mock('@/services/http/authRuntime', () => ({
    getAuthBase: () => 'https://api.example.test',
    getAuthHeaders: () => ({}),
}));
vi.mock('@/services/routing/share', () => ({
    buildPointShareToken: () => 'hash',
}));
vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key }));
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useAuthStore.getState().clearSessionUser();
});

it.each([true, false])(
    'sends desired report=%s with the clicked image version, rolls back 409 and reloads public content including the selected detail',
    async (desired) => {
        useAuthStore
            .getState()
            .setSessionUser({ uid: 'reader', nickname: 'Reader' });
        const markerId = 'report-image-point';
        const imageA = {
            id: 'image',
            markerId,
            snapshotId: 'A',
            content: 'Public image A',
            flagged: !desired,
            status: 'active' as const,
            url: '/prod/A.webp',
            createdAt: '',
        };
        const imageB = {
            ...imageA,
            snapshotId: 'B',
            content: 'Public image B',
            flagged: false,
            url: '/prod/B.webp',
        };
        let replaced = false;
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockImplementation((input) => {
                const url =
                    input instanceof Request ? input.url : input.toString();
                if (/\/(?:un)?flag$/.test(url)) {
                    replaced = true;
                    return Promise.resolve(
                        Response.json(
                            { code: 'PUBLIC_SNAPSHOT_CONFLICT' },
                            { status: 409 },
                        ),
                    );
                }
                const image = replaced ? imageB : imageA;
                return Promise.resolve(
                    Response.json({
                        item: image,
                        items: [image],
                        images: { items: [image] },
                        mine: { items: [] },
                    }),
                );
            });
        vi.stubGlobal('fetch', fetch);
        const { result } = renderHook(() => {
            const images = useUGCPointImages(
                { id: markerId, type: 'aurylene' } as IMarkerData,
                true,
            );
            const [lastSubmission, setLastSubmission] =
                useState<UGCUploadSubmission | null>(null);
            const actions = useUGCImageActions(images, {
                lastSubmission,
                setLastSubmission,
                uploading: false,
                uploadSent: false,
                progress: 0,
                error: null,
                inputRef: useRef<HTMLInputElement | null>(null),
                canUpload: false,
                canAppendUpload: false,
                requestUpload: () => {},
                requestAppendUpload: () => {},
                upload: async () => {},
                uploadFile: async () => {},
            });
            return { images, actions };
        });
        await waitFor(() =>
            expect(result.current.images.active?.snapshotId).toBe('A'),
        );
        act(() => result.current.images.setRequestedImage(imageA));
        vi.useFakeTimers();
        act(() => result.current.actions.handleToggleFlag());
        expect(result.current.images.active?.flagged).toBe(desired);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(result.current.images.active).toMatchObject({
            snapshotId: 'B',
            content: 'Public image B',
        });
        expect(Boolean(result.current.images.active?.flagged)).toBe(false);
        expect(result.current.images.requestedImage?.snapshotId).toBe('B');
        expect(result.current.actions.reportError).toBe(
            'detail.errors.reportVersionChanged',
        );
        const calls = fetch.mock.calls.filter(([url]) =>
            /\/(?:un)?flag$/.test(
                url instanceof Request ? url.url : url.toString(),
            ),
        );
        expect(calls).toHaveLength(1);
        const body = calls[0][1]?.body;
        if (typeof body !== 'string')
            throw new Error('Expected JSON report body');
        expect(JSON.parse(body) as unknown).toEqual({
            snapshotId: 'A',
        });
    },
);

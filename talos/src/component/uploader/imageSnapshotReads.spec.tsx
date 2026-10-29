import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/auth';
import type { IMarkerData } from '@/data/marker';
import useUGCPointImages from './useUGCPointImages';
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useAuthStore.getState().clearSessionUser();
});

it.each(['pending_audit', 'stale'] as const)(
    'uses the %s owner snapshot URL with its body and identity when public A and private B share a submission',
    async (status) => {
        useAuthStore
            .getState()
            .setSessionUser({ uid: 'owner', nickname: 'Owner' });
        const markerId = `image-snapshot-point-${status}`;
        const publicImage = {
            id: 'same-image',
            snapshotId: 'A',
            markerId,
            url: 'https://assets.example/prod/A.webp',
            content: 'Public A',
            status: 'active',
            createdAt: '',
        };
        const ownImage = {
            ...publicImage,
            snapshotId: 'B',
            url: 'https://api.example/uploads/v1/file/prod/B.webp',
            filePath: 'prod/B.webp',
            content: 'Private B',
            status,
            poiHash: 'hash',
            poiType: 'aurylene',
        };
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                Response.json({
                    images: { items: [publicImage] },
                    mine: { items: [ownImage] },
                }),
            ),
        );
        const { result } = renderHook(() =>
            useUGCPointImages(
                { id: markerId, type: 'aurylene' } as IMarkerData,
                true,
            ),
        );
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.activeImages).toHaveLength(1);
        expect(result.current.activeImages[0]).toMatchObject({
            id: 'same-image',
            snapshotId: 'B',
            content: 'Private B',
        });
        // DEV rewrites the owner's selected file through the private file route.
        expect(result.current.activeImages[0].url).toContain(
            '/file/prod/B.webp',
        );
    },
);

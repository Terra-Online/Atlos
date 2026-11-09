import { useRef, useState } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/auth';
import type {
    UGCImage,
    UGCSubmissionImage,
    UGCUploadSubmission,
} from '@/services/ugc/client';
import useUGCImageActions from './useUGCImageActions';
vi.mock('@/data/marker', () => ({ MARKER_TYPE_DICT: {} }));
vi.mock('@/services/routing/share', () => ({
    buildPointShareToken: () => 'hash',
}));
vi.mock('@/services/http/authRuntime', () => ({
    getAuthBase: () => '',
    getAuthHeaders: () => ({}),
}));
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const image: UGCSubmissionImage = {
    id: 'photo',
    snapshotId: 'A',
    markerId: 'delete-image',
    url: '/private-file',
    filePath: 'retained.webp',
    content: 'Image',
    status: 'stale',
    createdAt: '',
    poiHash: 'hash',
    poiType: 'poi',
};
beforeEach(() => {
    useAuthStore.getState().setSessionUser({ uid: 'owner', nickname: 'Owner' });
    fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useAuthStore.getState().clearSessionUser();
});
function setup(own = true) {
    return renderHook(() => {
        const [images, setImages] = useState<UGCImage[]>([image]);
        const [myImages, setMyImages] = useState([image]);
        const [requestedImage, setRequestedImage] = useState<UGCImage | null>(
            image,
        );
        const [selectedImageId, setSelectedImageId] = useState<string | null>(
            image.id,
        );
        const [viewerOpen, setViewerOpen] = useState(true);
        const [lastSubmission, setLastSubmission] =
            useState<UGCUploadSubmission | null>(null);
        const actions = useUGCImageActions(
            {
                images,
                setImages,
                myImages,
                setMyImages,
                active: myImages[0] ?? null,
                activeImages: images,
                selectedImageId,
                setSelectedImageId,
                isOwnActive: own,
                isActivePending: false,
                pendingOwn: null,
                pointImages: images,
                pointMyImages: myImages,
                loading: false,
                show: true,
                target: null,
                requestedImage,
                setRequestedImage,
                patchImageById: () => {},
                applyServerImage: () => {},
                viewerOpen,
                setViewerOpen,
            },
            {
                uploading: false,
                uploadSent: false,
                progress: 0,
                error: null,
                lastSubmission,
                setLastSubmission,
                inputRef: useRef<HTMLInputElement | null>(null),
                canUpload: false,
                canAppendUpload: false,
                requestUpload: () => {},
                requestAppendUpload: () => {},
                upload: async () => {},
                uploadFile: async () => {},
            },
        );
        return {
            ...actions,
            images,
            myImages,
            viewerOpen,
            requestedImage,
            selectedImageId,
        };
    });
}
it.each([false, true])(
    'uses owner DELETE for an archived image and rolls back optimistic removal on failure=%s',
    async (failure) => {
        let deliver!: (r: Response) => void;
        fetcher.mockReturnValueOnce(
            new Promise((resolve) => {
                deliver = resolve;
            }),
        );
        const now = vi.spyOn(Date, 'now');
        now.mockReturnValue(1000);
        const { result } = setup();
        await act(() => result.current.handleDelete());
        expect(fetcher).not.toHaveBeenCalled();
        now.mockReturnValue(2100);
        let request!: Promise<void>;
        act(() => {
            request = result.current.handleDelete();
        });
        expect(result.current.images).toEqual([]);
        expect(result.current.myImages).toEqual([]);
        expect(result.current.viewerOpen).toBe(false);
        expect(fetcher.mock.calls[0][0]).toMatch(/images\/photo$/);
        expect(fetcher.mock.calls[0][1]?.method).toBe('DELETE');
        await act(async () => {
            deliver(
                failure
                    ? Response.json({}, { status: 500 })
                    : Response.json({
                          ok: true,
                          authorDeletedAt: 'first-delete',
                      }),
            );
            await request;
        });
        await waitFor(() => expect(result.current.actionPending).toBe(false));
        if (failure) {
            expect(result.current.images).toEqual([image]);
            expect(result.current.myImages).toEqual([image]);
            expect(result.current.viewerOpen).toBe(true);
            expect(result.current.selectedImageId).toBe('photo');
            expect(result.current.requestedImage).toEqual(image);
        } else {
            expect(result.current.myImages).toEqual([]);
            expect(result.current.viewerOpen).toBe(false);
        }
    },
);
it('keeps another author image unchanged and never sends an owner action', async () => {
    const { result } = setup(false);
    await act(() => result.current.handleDelete());
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.images).toEqual([image]);
});

it('does not restore an archived image from a late deletion failure after switching accounts', async () => {
    let deliver!: (response: Response) => void;
    fetcher.mockReturnValueOnce(
        new Promise((resolve) => {
            deliver = resolve;
        }),
    );
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { result } = setup();
    await act(() => result.current.handleDelete());
    now.mockReturnValue(2100);
    let request!: Promise<void>;
    act(() => {
        request = result.current.handleDelete();
    });
    act(() =>
        useAuthStore
            .getState()
            .setSessionUser({ uid: 'other', nickname: 'Other' }),
    );
    await act(async () => {
        deliver(Response.json({}, { status: 500 }));
        await request;
    });
    expect(result.current.myImages).toEqual([]);
    expect(result.current.requestedImage).toBeNull();
    expect(result.current.viewerOpen).toBe(false);
});

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { IMarkerData } from '@/data/marker';
import type { PointImagesState } from './useUGCPointImages';
import type { UGCUploadSubmission } from '@/services/ugc/client';
import useUGCUpload from './useUGCUpload';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), detail: vi.fn(), user: { uid: 'a' } as { uid: string } | null }));
vi.mock('@/store/auth', () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ sessionUser: mocks.user }) }));
vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key }));
vi.mock('@/component/shared/account/authEvents', () => ({ openOemAuthModal: vi.fn() }));
vi.mock('@/services/ugc/client', () => ({ uploadUGCImage: mocks.upload, listUGCPointImages: mocks.detail, UGCClientError: class extends Error {} }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

const point = (id: string): IMarkerData => ({ id, type: 'crate_ii', subregId: 'VL_1', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 });
function imageState(marker: IMarkerData): PointImagesState {
    return { target: { ...marker, uploadCategory: 'collection' }, images: [], myImages: [], activeImages: [], active: null,
        selectedImageId: null, isOwnActive: false, isActivePending: false, pendingOwn: null, pointImages: [], pointMyImages: [],
        loading: false, show: true, requestedImage: null, viewerOpen: false, setImages: vi.fn(), setMyImages: vi.fn(),
        setSelectedImageId: vi.fn(), setRequestedImage: vi.fn(), patchImageById: vi.fn(), applyServerImage: vi.fn(), setViewerOpen: vi.fn() };
}

it('preserves in-flight uploads across unmounts, releases expired completed tasks, and isolates accounts', async () => {
    vi.useFakeTimers(); mocks.user = { uid: 'a' }; mocks.detail.mockResolvedValue({});
    let complete!: (value: UGCUploadSubmission) => void;
    mocks.upload.mockImplementation(() => new Promise<UGCUploadSubmission>(resolve => { complete = resolve; }));
    const marker = point('upload-lifetime');
    const mount = () => renderHook(() => useUGCUpload(marker, imageState(marker)));
    const first = mount();
    let request!: Promise<void>;
    act(() => { request = first.result.current.uploadFile(new File(['image'], 'image.png')); });
    expect(first.result.current.uploading).toBe(true);
    first.unmount();
    vi.advanceTimersByTime(16 * 60_000);
    const second = mount();
    expect(second.result.current.uploading).toBe(true);
    await act(async () => {
        complete({ id: 'submitted', markerId: marker.id, status: 'pending_audit', filePath: '/image', snapshotId: 's' });
        await request;
    });
    expect(second.result.current.lastSubmission?.id).toBe('submitted');
    mocks.user = { uid: 'b' }; second.rerender();
    expect(second.result.current.lastSubmission).toBeNull();
    mocks.user = { uid: 'a' }; second.rerender();
    expect(second.result.current.lastSubmission?.id).toBe('submitted');
    vi.advanceTimersByTime(16 * 60_000); second.unmount();
    const third = mount();
    expect(third.result.current.lastSubmission).toBeNull();
    expect(third.result.current.uploading).toBe(false);
});

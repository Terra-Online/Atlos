import { getAuthBase } from '@/component/login/authFlow';
import { MARKER_TYPE_DICT, type IMarkerData } from '@/data/marker';
import { buildPointShareToken } from '@/utils/urlState';

export type UGCUploadableCategory = 'collection' | 'archives' | 'exploration';

export type UGCUploadTarget = IMarkerData & {
    uploadCategory: UGCUploadableCategory;
};

export type UGCSubmissionStatus =
    | 'pending_openai'
    | 'pending_audit'
    | 'active'
    | 'flagged'
    | 'remove_request'
    | 'stale';

export type UGCImage = {
    id: string;
    markerId: string;
    poiHash: string;
    poiType: string;
    snapshotId: string;
    url: string;
    filePath?: string;
    content: string | null;
    author?: {
        nickname: string;
        publicUid: string;
    } | null;
    createdAt: string;
    upvotes?: number;
    upvoteCount?: number;
    upvoted?: boolean;
    flagged?: boolean;
    recallRequested?: boolean;
    status?: UGCSubmissionStatus;
};

export type UGCUploadSubmission = {
    id: string;
    markerId: string;
    status: UGCSubmissionStatus;
    filePath: string;
    snapshotId: string;
};

export type UGCSubmissionImage = UGCImage & {
    status: UGCSubmissionStatus;
};

type ImageCacheEntry = {
    expiresAt: number;
    images: UGCImage[];
};

type PendingImageRequest = {
    markerId: string;
    resolve: (images: UGCImage[]) => void;
    reject: (error: unknown) => void;
};

type SubmissionCacheEntry = {
    expiresAt: number;
    images: UGCSubmissionImage[];
};

type PendingSubmissionRequest = {
    markerId: string;
    resolve: (images: UGCSubmissionImage[]) => void;
    reject: (error: unknown) => void;
};

const UGC_API_BASE = `${getAuthBase()}/uploads/v1`;
const IMAGE_CACHE_TTL_MS = 60_000;
const SUBMISSION_CACHE_TTL_MS = 30_000;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const CLIENT_WEBP_MAX_BYTES = 4 * 1024 * 1024;
const CLIENT_WEBP_MAX_EDGE = 2160;
const CLIENT_WEBP_QUALITY = 0.8;
const UGC_UPLOADABLE_CATEGORIES = new Set<UGCUploadableCategory>([
    'collection',
    'archives',
    'exploration',
]);
const imageCache = new Map<string, ImageCacheEntry>();
const imageInFlight = new Map<string, Promise<UGCImage[]>>();
const submissionCache = new Map<string, SubmissionCacheEntry>();
const submissionInFlight = new Map<string, Promise<UGCSubmissionImage[]>>();
let pendingImageBatchTimer: number | null = null;
let pendingImageBatchRequests: PendingImageRequest[] = [];
let pendingSubmissionBatchTimer: number | null = null;
let pendingSubmissionBatchRequests: PendingSubmissionRequest[] = [];

export class UGCClientError extends Error {
    readonly code: string;
    readonly status?: number;

    constructor(message: string, code = 'UGC_ERROR', status?: number) {
        super(message);
        this.name = 'UGCClientError';
        this.code = code;
        this.status = status;
    }
}

export const invalidateUGCImageCache = (markerId: string): void => {
    imageCache.delete(markerId);
};

export const invalidateUGCSubmissionCache = (markerId: string): void => {
    submissionCache.delete(markerId);
};

export function resolveUGCUploadTarget(point: IMarkerData): UGCUploadTarget | null {
    const category = MARKER_TYPE_DICT[point.type]?.category?.sub;
    if (!isUGCUploadableCategory(category)) {
        return null;
    }
    return {
        ...point,
        uploadCategory: category,
    };
}

export async function listUGCImages(markerId: string): Promise<UGCImage[]> {
    return listUGCImagesByMarkerIds([markerId]).then((grouped) => grouped[markerId] ?? []);
}

export async function listUGCImagesByMarkerIds(markerIds: string[]): Promise<Record<string, UGCImage[]>> {
    const normalizedIds = [...new Set(markerIds.map((item) => item.trim()).filter(Boolean))];
    const result: Record<string, UGCImage[]> = {};
    const pendingIds: string[] = [];

    normalizedIds.forEach((markerId) => {
        const cached = imageCache.get(markerId);
        if (cached && cached.expiresAt > Date.now()) {
            result[markerId] = cached.images;
            return;
        }

        pendingIds.push(markerId);
    });

    if (pendingIds.length === 0) {
        return result;
    }

    const fetchedEntries = await Promise.all(
        pendingIds.map(async (markerId) => [markerId, await getOrQueueUGCImages(markerId)] as const),
    );

    fetchedEntries.forEach(([markerId, images]) => {
        result[markerId] = images;
    });

    return result;
}

export async function listUGCMyImages(markerId: string): Promise<UGCSubmissionImage[]> {
    return listUGCMyImagesByMarkerIds([markerId]).then((grouped) => grouped[markerId] ?? []);
}

export async function listUGCMyImagesByMarkerIds(markerIds: string[]): Promise<Record<string, UGCSubmissionImage[]>> {
    const normalizedIds = [...new Set(markerIds.map((item) => item.trim()).filter(Boolean))];
    const result: Record<string, UGCSubmissionImage[]> = {};
    const pendingIds: string[] = [];

    normalizedIds.forEach((markerId) => {
        const cached = submissionCache.get(markerId);
        if (cached && cached.expiresAt > Date.now()) {
            result[markerId] = cached.images;
            return;
        }

        pendingIds.push(markerId);
    });

    if (pendingIds.length === 0) {
        return result;
    }

    const fetchedEntries = await Promise.all(
        pendingIds.map(async (markerId) => [markerId, await getOrQueueUGCMyImages(markerId)] as const),
    );

    fetchedEntries.forEach(([markerId, images]) => {
        result[markerId] = images;
    });

    return result;
}

export async function uploadUGCImage(
    point: UGCUploadTarget,
    file: File,
    onProgress?: (progress: number) => void,
): Promise<UGCUploadSubmission> {
    validateUploadImage(file);
    const preparedFile = await prepareClientUploadImage(file, onProgress);
    const formData = new FormData();
    formData.set('markerId', point.id);
    formData.set('poiHash', buildPoiHash(point));
    formData.set('poiType', point.type);
    formData.set('file', preparedFile);

    const payload = await uploadFormData<{
        submission?: UGCUploadSubmission;
    }>(`${UGC_API_BASE}/images`, formData, (progress) => {
        onProgress?.(0.35 + progress * 0.65);
    });
    if (!payload.submission) {
        throw new UGCClientError('Upload response missing submission.', 'uploadInvalidResponse');
    }

    invalidateUGCImageCache(point.id);
    invalidateUGCSubmissionCache(point.id);
    return payload.submission;
}

export type UGCImageActionPatch = Partial<Pick<UGCImage, 'upvoteCount' | 'upvotes' | 'upvoted' | 'flagged' | 'recallRequested' | 'status'>> & {
    id: string;
};

type UGCImageActionResponse = {
    ok?: boolean;
    image?: UGCImage;
    upvoteCount?: number;
    flagCount?: number;
    status?: UGCSubmissionStatus;
};

export async function toggleUGCImageUpvote(imageId: string, upvoted: boolean): Promise<UGCImageActionPatch> {
    return updateUGCImageAction(imageId, upvoted ? 'upvote' : 'unvote');
}

export async function toggleUGCImageFlag(imageId: string, flagged: boolean): Promise<UGCImageActionPatch> {
    return updateUGCImageAction(imageId, flagged ? 'flag' : 'unflag');
}

export async function toggleUGCImageRecall(imageId: string, recallRequested: boolean): Promise<UGCImageActionPatch> {
    return updateUGCImageAction(imageId, recallRequested ? 'remove-request' : 'unrecall');
}

async function updateUGCImageAction(imageId: string, action: string): Promise<UGCImageActionPatch> {
    const response = await fetch(`${UGC_API_BASE}/images/${encodeURIComponent(imageId)}/${action}`, {
        method: 'POST',
        credentials: 'include',
    });

    if (!response.ok) {
        throw await readUGCError(response);
    }

    const payload = await response.json() as UGCImageActionResponse;
    if (payload.image) {
        const image = normalizeUGCImage(payload.image);
        invalidateUGCImageCache(image.markerId);
        invalidateUGCSubmissionCache(image.markerId);
        return image;
    }

    if (payload.ok !== true) {
        throw new UGCClientError('Image action response is invalid.', 'imageActionInvalidResponse');
    }

    const patch: UGCImageActionPatch = { id: imageId };
    if (Number.isFinite(payload.upvoteCount)) {
        patch.upvoteCount = Math.max(0, payload.upvoteCount as number);
        patch.upvotes = patch.upvoteCount;
        patch.upvoted = action === 'upvote';
    }
    if (Number.isFinite(payload.flagCount)) {
        patch.flagged = action === 'flag';
    }
    if (payload.status) {
        patch.status = payload.status;
        patch.recallRequested = payload.status === 'remove_request';
        if (payload.status === 'flagged') {
            patch.flagged = true;
        }
        if (payload.status === 'active' && (action === 'unflag' || action === 'unrecall')) {
            patch.flagged = false;
        }
    }
    return patch;
}

function buildPoiHash(point: IMarkerData): string {
    const token = buildPointShareToken(point);
    if (!token.startsWith('?')) return token;

    return new URLSearchParams(token.slice(1)).get('x') ?? point.id;
}

function isUGCUploadableCategory(value: unknown): value is UGCUploadableCategory {
    return typeof value === 'string' && UGC_UPLOADABLE_CATEGORIES.has(value as UGCUploadableCategory);
}

function validateUploadImage(file: File): void {
    const normalizedType = file.type.toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(normalizedType)) {
        throw new UGCClientError('Unsupported image type.', 'unsupportedType');
    }

    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
        throw new UGCClientError('Image is too large.', 'fileTooLarge');
    }
}

async function prepareClientUploadImage(
    file: File,
    onProgress?: (progress: number) => void,
): Promise<File> {
    if (file.size >= CLIENT_WEBP_MAX_BYTES) {
        onProgress?.(0.08);
        return file;
    }

    onProgress?.(0.08);
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new UGCClientError('Image could not be decoded.', 'imageDecodeFailed');
    }
    try {
        const edge = Math.max(bitmap.width, bitmap.height);
        if (edge >= CLIENT_WEBP_MAX_EDGE) {
            onProgress?.(0.18);
            return file;
        }

        if (file.type.toLowerCase() === 'image/webp') {
            onProgress?.(0.35);
            return file;
        }

        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new UGCClientError('Canvas unavailable.', 'imageProcessingUnavailable');
        }
        ctx.drawImage(bitmap, 0, 0);
        onProgress?.(0.2);

        const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, 'image/webp', CLIENT_WEBP_QUALITY);
        });
        if (!blob || blob.size <= 0 || blob.size > MAX_UPLOAD_BYTES) {
            throw new UGCClientError('Processed image is too large.', 'processedTooLarge');
        }

        onProgress?.(0.35);
        return new File([blob], replaceExtension(file.name, 'webp'), { type: 'image/webp' });
    } finally {
        bitmap.close();
    }
}

function replaceExtension(filename: string, ext: string): string {
    const base = filename.replace(/\.[^.]+$/, '');
    return `${base || 'upload'}.${ext}`;
}

function getOrQueueUGCImages(markerId: string): Promise<UGCImage[]> {
    const inFlight = imageInFlight.get(markerId);
    if (inFlight) {
        return inFlight;
    }

    const promise = new Promise<UGCImage[]>((resolve, reject) => {
        pendingImageBatchRequests.push({ markerId, resolve, reject });
        if (pendingImageBatchTimer !== null) {
            return;
        }

        pendingImageBatchTimer = window.setTimeout(() => {
            pendingImageBatchTimer = null;
            const requests = pendingImageBatchRequests;
            pendingImageBatchRequests = [];
            void flushUGCImageBatch(requests);
        }, 0);
    });

    imageInFlight.set(markerId, promise);
    return promise.finally(() => {
        imageInFlight.delete(markerId);
    });
}

function getOrQueueUGCMyImages(markerId: string): Promise<UGCSubmissionImage[]> {
    const inFlight = submissionInFlight.get(markerId);
    if (inFlight) {
        return inFlight;
    }

    const promise = new Promise<UGCSubmissionImage[]>((resolve, reject) => {
        pendingSubmissionBatchRequests.push({ markerId, resolve, reject });
        if (pendingSubmissionBatchTimer !== null) {
            return;
        }

        pendingSubmissionBatchTimer = window.setTimeout(() => {
            pendingSubmissionBatchTimer = null;
            const requests = pendingSubmissionBatchRequests;
            pendingSubmissionBatchRequests = [];
            void flushUGCSubmissionBatch(requests);
        }, 0);
    });

    submissionInFlight.set(markerId, promise);
    return promise.finally(() => {
        submissionInFlight.delete(markerId);
    });
}

async function flushUGCImageBatch(requests: PendingImageRequest[]): Promise<void> {
    const groupedResolvers = new Map<string, PendingImageRequest[]>();
    requests.forEach((request) => {
        const bucket = groupedResolvers.get(request.markerId);
        if (bucket) {
            bucket.push(request);
            return;
        }
        groupedResolvers.set(request.markerId, [request]);
    });

    const markerIds = [...groupedResolvers.keys()];
    const scope = import.meta.env.DEV ? 'test' : 'prod';

    try {
        const response = await fetch(
            `${UGC_API_BASE}/images?markerIds=${encodeURIComponent(markerIds.join(','))}&limit=6&scope=${scope}`,
            {
                credentials: 'include',
            },
        );

        if (!response.ok) {
            throw await readUGCError(response);
        }

        const payload = await response.json() as { items?: UGCImage[] };
        const groupedImages = new Map<string, UGCImage[]>();

        markerIds.forEach((markerId) => {
            groupedImages.set(markerId, []);
        });

        (payload.items ?? []).map(normalizeUGCImage).forEach((image) => {
            const images = groupedImages.get(image.markerId);
            if (images) {
                images.push(image);
            }
        });

        markerIds.forEach((markerId) => {
            const images = groupedImages.get(markerId) ?? [];
            imageCache.set(markerId, {
                expiresAt: Date.now() + IMAGE_CACHE_TTL_MS,
                images,
            });
            groupedResolvers.get(markerId)?.forEach((request) => {
                request.resolve(images);
            });
        });
    } catch (error) {
        groupedResolvers.forEach((entries) => {
            entries.forEach((request) => request.reject(error));
        });
    }
}

async function flushUGCSubmissionBatch(requests: PendingSubmissionRequest[]): Promise<void> {
    const groupedResolvers = new Map<string, PendingSubmissionRequest[]>();
    requests.forEach((request) => {
        const bucket = groupedResolvers.get(request.markerId);
        if (bucket) {
            bucket.push(request);
            return;
        }
        groupedResolvers.set(request.markerId, [request]);
    });

    const markerIds = [...groupedResolvers.keys()];
    const scope = import.meta.env.DEV ? 'test' : 'prod';

    try {
        const response = await fetch(
            `${UGC_API_BASE}/images/mine?markerIds=${encodeURIComponent(markerIds.join(','))}&limit=6&scope=${scope}`,
            {
                credentials: 'include',
            },
        );

        if (!response.ok) {
            throw await readUGCError(response);
        }

        const payload = await response.json() as { items?: UGCSubmissionImage[] };
        const groupedImages = new Map<string, UGCSubmissionImage[]>();

        markerIds.forEach((markerId) => {
            groupedImages.set(markerId, []);
        });

        (payload.items ?? []).map(normalizeUGCSubmissionImage).forEach((image) => {
            const images = groupedImages.get(image.markerId);
            if (images) {
                images.push(image);
            }
        });

        markerIds.forEach((markerId) => {
            const images = groupedImages.get(markerId) ?? [];
            submissionCache.set(markerId, {
                expiresAt: Date.now() + SUBMISSION_CACHE_TTL_MS,
                images,
            });
            groupedResolvers.get(markerId)?.forEach((request) => {
                request.resolve(images);
            });
        });
    } catch (error) {
        groupedResolvers.forEach((entries) => {
            entries.forEach((request) => request.reject(error));
        });
    }
}

function normalizeUGCImage(image: UGCImage): UGCImage {
    if (!import.meta.env.DEV) {
        return image;
    }

    const filePath = image.filePath ?? extractObjectPathFromUrl(image.url);
    if (!filePath) {
        return image;
    }

    return {
        ...image,
        filePath,
        url: `${UGC_API_BASE}/public-file/${encodeObjectPath(filePath)}`,
    };
}

function normalizeUGCSubmissionImage(image: UGCSubmissionImage): UGCSubmissionImage {
    if (!import.meta.env.DEV) {
        return image;
    }

    const filePath = image.filePath ?? extractObjectPathFromUrl(image.url);
    if (!filePath) {
        return image;
    }

    return {
        ...image,
        filePath,
        url: `${UGC_API_BASE}/public-file/${encodeObjectPath(filePath)}`,
    };
}

function extractObjectPathFromUrl(rawUrl: string): string | null {
    try {
        const url = new URL(rawUrl, window.location.origin);
        const publicFileMarker = '/uploads/v1/public-file/';
        const publicFileIndex = url.pathname.indexOf(publicFileMarker);
        if (publicFileIndex >= 0) {
            return decodeURIComponent(url.pathname.slice(publicFileIndex + publicFileMarker.length));
        }
        return decodeURIComponent(url.pathname.replace(/^\/+/, '')) || null;
    } catch {
        return null;
    }
}

function encodeObjectPath(path: string): string {
    return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

async function readUGCError(response: Response): Promise<UGCClientError> {
    try {
        const payload = await response.json() as {
            code?: string;
            message?: string;
            error?: {
                code?: string;
                message?: string;
            };
        };
        const code = payload.code || payload.error?.code || `HTTP_${response.status}`;
        const message = payload.message || payload.error?.message || code;
        return new UGCClientError(message, code, response.status);
    } catch {
        return new UGCClientError(`HTTP ${response.status}`, `HTTP_${response.status}`, response.status);
    }
}

function uploadFormData<T>(
    url: string,
    formData: FormData,
    onProgress?: (progress: number) => void,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.withCredentials = true;

        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || !onProgress) return;
            onProgress(Math.min(0.98, Math.max(0, event.loaded / event.total)));
        };

        xhr.onload = () => {
            const response = new Response(xhr.responseText, {
                status: xhr.status,
                headers: {
                    'content-type': xhr.getResponseHeader('content-type') || 'application/json',
                },
            });
            if (xhr.status < 200 || xhr.status >= 300) {
                void readUGCError(response).then(reject);
                return;
            }

            try {
                onProgress?.(1);
                resolve(JSON.parse(xhr.responseText) as T);
            } catch {
                reject(new UGCClientError('Upload response is invalid JSON.', 'uploadInvalidResponse'));
            }
        };

        xhr.onerror = () => reject(new UGCClientError('Upload failed.', 'uploadNetwork'));
        xhr.onabort = () => reject(new UGCClientError('Upload aborted.', 'uploadAborted'));
        xhr.send(formData);
    });
}

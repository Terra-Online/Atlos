import { getAuthBase, getAuthHeaders } from '@/component/login/authFlow';
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
    url: string;
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

export type UGCCommentVoteValue = -1 | 0 | 1;

export type UGCCommentAuthor = {
    nickname: string;
    publicUid: string;
    avatar?: number;
};

export type UGCComment = {
    id: string;
    markerId: string;
    poiHash?: string;
    poiType?: string;
    parentId: string | null;
    depth: number;
    content: string;
    translatedContent?: string;
    translationSourceLanguage?: string;
    translationTargetLanguage?: string;
    translationHidden?: boolean;
    translationStatus?: 'translating' | 'failed';
    editUndoAvailable?: boolean;
    author?: UGCCommentAuthor | null;
    createdAt: string;
    score: number;
    viewerVote?: UGCCommentVoteValue;
    flagged?: boolean;
    recallRequested?: boolean;
    status?: UGCSubmissionStatus;
    replyCount: number;
    replies: UGCComment[];
};

export type UGCUploadSubmission = {
    id: string;
    markerId: string;
    status: UGCSubmissionStatus;
    filePath: string;
    snapshotId: string;
};

export type UGCSubmissionImage = UGCImage & {
    poiHash: string;
    poiType: string;
    snapshotId: string;
    filePath: string;
    flagCount?: number;
    status: UGCSubmissionStatus;
};

export type UGCCommentSubmission = {
    id: string;
    markerId: string;
    parentId: string | null;
    depth: number;
    status: UGCSubmissionStatus;
    snapshotId: string;
};

type ImageCacheEntry = {
    expiresAt: number;
    images: UGCImage[];
};

type CommentCacheEntry = {
    expiresAt: number;
    comments: UGCComment[];
};

type PendingImageRequest = {
    markerId: string;
    resolve: (images: UGCImage[]) => void;
    reject: (error: unknown) => void;
};

type PendingCommentRequest = {
    markerId: string;
    resolve: (comments: UGCComment[]) => void;
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
const PRIVATE_IMAGE_CACHE_POSITIVE_TTL_MS = 5 * 60 * 1000;
const PUBLIC_IMAGE_CACHE_POSITIVE_TTL_MS = 30 * 1000;
const IMAGE_CACHE_EMPTY_TTL_MS = 10 * 1000;
const COMMENT_CACHE_POSITIVE_TTL_MS = 30 * 1000;
const COMMENT_CACHE_EMPTY_TTL_MS = 10 * 1000;
const SUBMISSION_CACHE_TTL_MS = 0;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const CLIENT_WEBP_MAX_BYTES = 4 * 1024 * 1024;
const CLIENT_WEBP_MAX_EDGE = 2160;
const CLIENT_WEBP_QUALITY = 0.8;
const SUPPORTED_UPLOAD_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/heic',
    'image/heif',
]);
const HEIC_EXT_RE = /\.(heic|heif)$/i;
const UGC_UPLOADABLE_CATEGORIES = new Set<UGCUploadableCategory>([
    'collection',
    'archives',
    'exploration',
]);
const imageCache = new Map<string, ImageCacheEntry>();
const imageInFlight = new Map<string, Promise<UGCImage[]>>();
const publicImageCache = new Map<string, ImageCacheEntry>();
const publicImageInFlight = new Map<string, Promise<UGCImage[]>>();
const commentCache = new Map<string, CommentCacheEntry>();
const commentInFlight = new Map<string, Promise<UGCComment[]>>();
const submissionCache = new Map<string, SubmissionCacheEntry>();
const submissionInFlight = new Map<string, Promise<UGCSubmissionImage[]>>();
let pendingImageBatchTimer: number | null = null;
let pendingImageBatchRequests: PendingImageRequest[] = [];
let pendingPublicImageBatchTimer: number | null = null;
let pendingPublicImageBatchRequests: PendingImageRequest[] = [];
let pendingCommentBatchTimer: number | null = null;
let pendingCommentBatchRequests: PendingCommentRequest[] = [];
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

export const invalidateUGCPublicImageCache = (markerId: string): void => {
    publicImageCache.delete(markerId);
};

export const invalidateUGCSubmissionCache = (markerId: string): void => {
    submissionCache.delete(markerId);
};

export const invalidateUGCCommentCache = (markerId: string): void => {
    commentCache.delete(markerId);
};

export const peekUGCImages = (markerId: string): UGCImage[] | null => {
    const cached = imageCache.get(markerId);
    if (!cached || cached.expiresAt <= Date.now()) {
        return null;
    }
    return cached.images;
};

export const peekPublicUGCImages = (markerId: string): UGCImage[] | null => {
    const cached = publicImageCache.get(markerId);
    if (!cached || cached.expiresAt <= Date.now()) {
        return null;
    }
    return cached.images;
};

export const peekUGCComments = (markerId: string): UGCComment[] | null => {
    const cached = commentCache.get(markerId);
    if (!cached || cached.expiresAt <= Date.now()) {
        return null;
    }
    return cached.comments;
};

export const peekUGCMyImages = (markerId: string): UGCSubmissionImage[] | null => {
    const cached = submissionCache.get(markerId);
    if (!cached || cached.expiresAt <= Date.now()) {
        return null;
    }
    return cached.images;
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

export async function listPublicUGCImages(markerId: string): Promise<UGCImage[]> {
    return listPublicUGCImagesByMarkerIds([markerId]).then((grouped) => grouped[markerId] ?? []);
}

export async function listUGCComments(markerId: string): Promise<UGCComment[]> {
    return listUGCCommentsByMarkerIds([markerId]).then((grouped) => grouped[markerId] ?? []);
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

export async function listPublicUGCImagesByMarkerIds(markerIds: string[]): Promise<Record<string, UGCImage[]>> {
    const normalizedIds = [...new Set(markerIds.map((item) => item.trim()).filter(Boolean))];
    const result: Record<string, UGCImage[]> = {};
    const pendingIds: string[] = [];

    normalizedIds.forEach((markerId) => {
        const cached = publicImageCache.get(markerId);
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
        pendingIds.map(async (markerId) => [markerId, await getOrQueuePublicUGCImages(markerId)] as const),
    );

    fetchedEntries.forEach(([markerId, images]) => {
        result[markerId] = images;
    });

    return result;
}

export async function listUGCCommentsByMarkerIds(markerIds: string[]): Promise<Record<string, UGCComment[]>> {
    const normalizedIds = [...new Set(markerIds.map((item) => item.trim()).filter(Boolean))];
    const result: Record<string, UGCComment[]> = {};
    const pendingIds: string[] = [];

    normalizedIds.forEach((markerId) => {
        const cached = commentCache.get(markerId);
        if (cached && cached.expiresAt > Date.now()) {
            result[markerId] = cached.comments;
            return;
        }

        pendingIds.push(markerId);
    });

    if (pendingIds.length === 0) {
        return result;
    }

    const fetchedEntries = await Promise.all(
        pendingIds.map(async (markerId) => [markerId, await getOrQueueUGCComments(markerId)] as const),
    );

    fetchedEntries.forEach(([markerId, comments]) => {
        result[markerId] = comments;
    });

    return result;
}

export async function listUGCMyImages(markerId: string): Promise<UGCSubmissionImage[]> {
    return listUGCMyImagesByMarkerIds([markerId]).then((grouped) => grouped[markerId] ?? []);
}

export async function getUGCImageById(markerId: string, imageId: string): Promise<UGCImage> {
    const scope = import.meta.env.DEV ? 'test' : 'prod';
    const search = new URLSearchParams({
        markerId,
        scope,
    });
    const response = await fetch(
        `${UGC_API_BASE}/images/${encodeURIComponent(imageId)}?${search.toString()}`,
        {
            credentials: 'include',
            headers: getAuthHeaders(),
        },
    );
    if (!response.ok) {
        throw await readUGCError(response);
    }
    const payload = await response.json() as { item?: UGCImage };
    if (!payload.item) {
        throw new UGCClientError('Image response is missing.', 'UGC_ERROR');
    }
    return normalizeUGCImage(payload.item);
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
    onUploadSent?: () => void,
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
    }, () => {
        onProgress?.(1);
        onUploadSent?.();
    });
    if (!payload.submission) {
        throw new UGCClientError('Upload response missing submission.', 'uploadInvalidResponse');
    }

    invalidateUGCImageCache(point.id);
    invalidateUGCPublicImageCache(point.id);
    invalidateUGCSubmissionCache(point.id);
    return payload.submission;
}

export async function submitUGCComment(
    point: IMarkerData,
    content: string,
    parentId?: string | null,
): Promise<UGCCommentSubmission> {
    const payload = await postJson<{
        submission?: UGCCommentSubmission;
    }>(`${UGC_API_BASE}/comments`, {
        markerId: point.id,
        poiHash: buildPoiHash(point),
        poiType: point.type,
        content,
        ...(parentId ? { parentId } : {}),
    });

    if (!payload.submission) {
        throw new UGCClientError('Comment response missing submission.', 'commentInvalidResponse');
    }

    invalidateUGCCommentCache(point.id);
    return payload.submission;
}

export async function editUGCComment(
    commentId: string,
    content: string,
): Promise<UGCCommentSubmission> {
    const payload = await postJson<{
        submission?: UGCCommentSubmission;
    }>(`${UGC_API_BASE}/comments/${encodeURIComponent(commentId)}/edit`, { content });

    if (!payload.submission) {
        throw new UGCClientError('Comment edit response missing submission.', 'commentInvalidResponse');
    }

    invalidateUGCCommentCache(payload.submission.markerId);
    return payload.submission;
}

export type UGCImageActionPatch = Partial<Pick<UGCImage, 'upvoteCount' | 'upvotes' | 'upvoted' | 'flagged' | 'recallRequested' | 'status'>> & {
    id: string;
};

export type UGCCommentActionPatch = Partial<Pick<UGCComment, 'content' | 'score' | 'viewerVote' | 'flagged' | 'recallRequested' | 'status' | 'editUndoAvailable'>> & {
    id: string;
    editReverted?: boolean;
};

type UGCImageActionResponse = {
    ok?: boolean;
    image?: UGCImage;
    upvoteCount?: number;
    flagCount?: number;
    status?: UGCSubmissionStatus;
};

type UGCCommentActionResponse = {
    ok?: boolean;
    comment?: UGCComment;
    vote?: UGCCommentVoteValue;
    score?: number;
    flagCount?: number;
    status?: UGCSubmissionStatus;
    content?: string;
    editReverted?: boolean;
};

export type UGCCommentTrans = {
    commentId: string;
    translatedContent?: string;
    sourceLanguage?: string;
    targetLanguage: string;
    provider: string;
    glossaryApplied: boolean;
    cached: boolean;
    error?: string;
};

export type UGCCommentTransOptions = {
    cachedOnly?: boolean;
    sourceLang?: string;
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

export async function recallUGCImage(imageId: string): Promise<UGCImageActionPatch> {
    return updateUGCImageAction(imageId, 'recall');
}

export async function voteUGCComment(commentId: string, value: 1 | -1): Promise<UGCCommentActionPatch> {
    return updateUGCCommentAction(commentId, value === 1 ? 'upvote' : 'downvote');
}

export async function toggleUGCCommentFlag(commentId: string, flagged: boolean): Promise<UGCCommentActionPatch> {
    return updateUGCCommentAction(commentId, flagged ? 'flag' : 'unflag');
}

export async function requestUGCCommentRemoval(commentId: string): Promise<UGCCommentActionPatch> {
    return updateUGCCommentAction(commentId, 'remove-request');
}

export async function recallUGCComment(commentId: string): Promise<UGCCommentActionPatch> {
    return updateUGCCommentAction(commentId, 'recall');
}

export async function transUGCComments(
    commentIds: string[],
    targetLang: string,
    sourceLangOrOptions?: string | UGCCommentTransOptions,
): Promise<UGCCommentTrans[]> {
    const normalizedIds = [...new Set(commentIds.map((id) => id.trim()).filter(Boolean))];
    if (normalizedIds.length === 0) return [];
    const options = typeof sourceLangOrOptions === 'string'
        ? { sourceLang: sourceLangOrOptions }
        : sourceLangOrOptions;

    const payload = await postJson<{ items?: UGCCommentTrans[] }>(
        `${UGC_API_BASE}/comments/translations`,
        {
            commentIds: normalizedIds,
            targetLanguage: targetLang,
            ...(options?.sourceLang ? { sourceLanguage: options.sourceLang } : {}),
            ...(options?.cachedOnly ? { cachedOnly: true } : {}),
        },
        !options?.cachedOnly,
    );

    return payload.items ?? [];
}

async function updateUGCImageAction(imageId: string, action: string): Promise<UGCImageActionPatch> {
    const response = await fetch(`${UGC_API_BASE}/images/${encodeURIComponent(imageId)}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
    });

    if (!response.ok) {
        throw await readUGCError(response);
    }

    const payload = await response.json() as UGCImageActionResponse;
    if (payload.image) {
        const image = normalizeUGCImage(payload.image);
        invalidateUGCImageCache(image.markerId);
        invalidateUGCPublicImageCache(image.markerId);
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

async function updateUGCCommentAction(commentId: string, action: string): Promise<UGCCommentActionPatch> {
    const payload = await postJson<UGCCommentActionResponse>(
        `${UGC_API_BASE}/comments/${encodeURIComponent(commentId)}/${action}`,
        undefined,
    );

    if (payload.comment) {
        const comment = normalizeUGCComment(payload.comment);
        invalidateUGCCommentCache(comment.markerId);
        return comment;
    }

    if (payload.ok !== true) {
        throw new UGCClientError('Comment action response is invalid.', 'commentActionInvalidResponse');
    }

    const patch: UGCCommentActionPatch = { id: commentId };
    if (Number.isFinite(payload.score)) {
        patch.score = Math.trunc(payload.score as number);
    }
    if (payload.vote === -1 || payload.vote === 0 || payload.vote === 1) {
        patch.viewerVote = payload.vote;
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
        if (payload.status === 'active' && action === 'unflag') {
            patch.flagged = false;
        }
    }
    if (payload.editReverted && typeof payload.content === 'string') {
        patch.content = payload.content;
        patch.editReverted = true;
        patch.editUndoAvailable = false;
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
    if (!SUPPORTED_UPLOAD_MIME_TYPES.has(normalizedType) && !HEIC_EXT_RE.test(file.name)) {
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
    if (file.type.toLowerCase() === 'image/heic' || file.type.toLowerCase() === 'image/heif' || HEIC_EXT_RE.test(file.name)) {
        onProgress?.(0.35);
        return file;
    }

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

function getOrQueuePublicUGCImages(markerId: string): Promise<UGCImage[]> {
    const inFlight = publicImageInFlight.get(markerId);
    if (inFlight) {
        return inFlight;
    }

    const promise = new Promise<UGCImage[]>((resolve, reject) => {
        pendingPublicImageBatchRequests.push({ markerId, resolve, reject });
        if (pendingPublicImageBatchTimer !== null) {
            return;
        }

        pendingPublicImageBatchTimer = window.setTimeout(() => {
            pendingPublicImageBatchTimer = null;
            const requests = pendingPublicImageBatchRequests;
            pendingPublicImageBatchRequests = [];
            void flushPublicUGCImageBatch(requests);
        }, 0);
    });

    publicImageInFlight.set(markerId, promise);
    return promise.finally(() => {
        publicImageInFlight.delete(markerId);
    });
}

function getOrQueueUGCComments(markerId: string): Promise<UGCComment[]> {
    const inFlight = commentInFlight.get(markerId);
    if (inFlight) {
        return inFlight;
    }

    const promise = new Promise<UGCComment[]>((resolve, reject) => {
        pendingCommentBatchRequests.push({ markerId, resolve, reject });
        if (pendingCommentBatchTimer !== null) {
            return;
        }

        pendingCommentBatchTimer = window.setTimeout(() => {
            pendingCommentBatchTimer = null;
            const requests = pendingCommentBatchRequests;
            pendingCommentBatchRequests = [];
            void flushUGCCommentBatch(requests);
        }, 0);
    });

    commentInFlight.set(markerId, promise);
    return promise.finally(() => {
        commentInFlight.delete(markerId);
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
                headers: getAuthHeaders(),
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
                expiresAt: Date.now() + (images.length > 0 ? PRIVATE_IMAGE_CACHE_POSITIVE_TTL_MS : IMAGE_CACHE_EMPTY_TTL_MS),
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

async function flushPublicUGCImageBatch(requests: PendingImageRequest[]): Promise<void> {
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
            `${UGC_API_BASE}/images?markerIds=${encodeURIComponent(markerIds.join(','))}&limit=6&scope=${scope}&publicOnly=1`,
            {
                credentials: 'omit',
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
            publicImageCache.set(markerId, {
                expiresAt: Date.now() + (images.length > 0 ? PUBLIC_IMAGE_CACHE_POSITIVE_TTL_MS : IMAGE_CACHE_EMPTY_TTL_MS),
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

async function flushUGCCommentBatch(requests: PendingCommentRequest[]): Promise<void> {
    const groupedResolvers = new Map<string, PendingCommentRequest[]>();
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
            `${UGC_API_BASE}/comments?markerIds=${encodeURIComponent(markerIds.join(','))}&limit=20&replyLimit=10&scope=${scope}`,
            {
                credentials: 'include',
                headers: getAuthHeaders(),
            },
        );

        if (!response.ok) {
            throw await readUGCError(response);
        }

        const payload = await response.json() as { items?: UGCComment[] };
        const groupedComments = new Map<string, UGCComment[]>();

        markerIds.forEach((markerId) => {
            groupedComments.set(markerId, []);
        });

        (payload.items ?? []).map(normalizeUGCComment).forEach((comment) => {
            const comments = groupedComments.get(comment.markerId);
            if (comments) {
                comments.push(comment);
            }
        });

        markerIds.forEach((markerId) => {
            const comments = groupedComments.get(markerId) ?? [];
            commentCache.set(markerId, {
                expiresAt: Date.now() + (comments.length > 0 ? COMMENT_CACHE_POSITIVE_TTL_MS : COMMENT_CACHE_EMPTY_TTL_MS),
                comments,
            });
            groupedResolvers.get(markerId)?.forEach((request) => {
                request.resolve(comments);
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
                headers: getAuthHeaders(),
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

    const filePath = extractObjectPathFromUrl(image.url);
    if (!filePath) {
        return image;
    }

    return {
        ...image,
        url: `${UGC_API_BASE}/public-file/${encodeObjectPath(filePath)}`,
    };
}

function normalizeUGCComment(comment: UGCComment): UGCComment {
    const status = comment.status;
    const rawAvatar = comment.author?.avatar;
    const avatar = Number.isFinite(rawAvatar) ? Math.floor(rawAvatar as number) : undefined;
    const author = comment.author
        ? {
            ...comment.author,
            ...(avatar !== undefined && avatar >= 1 ? { avatar } : { avatar: undefined }),
        }
        : comment.author;

    return {
        ...comment,
        author,
        parentId: comment.parentId ?? null,
        depth: Number.isFinite(comment.depth) ? Math.max(0, Math.trunc(comment.depth)) : 0,
        score: Number.isFinite(comment.score) ? Math.trunc(comment.score) : 0,
        viewerVote: comment.viewerVote === -1 || comment.viewerVote === 1 ? comment.viewerVote : comment.viewerVote === 0 ? 0 : undefined,
        flagged: comment.flagged,
        recallRequested: Boolean(comment.recallRequested || status === 'remove_request'),
        replyCount: Number.isFinite(comment.replyCount) ? Math.max(0, Math.trunc(comment.replyCount)) : comment.replies?.length ?? 0,
        replies: (comment.replies ?? []).map(normalizeUGCComment),
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
        url: `${UGC_API_BASE}/${isPendingUGCStatus(image.status) ? 'file' : 'public-file'}/${encodeObjectPath(filePath)}`,
    };
}

function isPendingUGCStatus(status: UGCSubmissionStatus | undefined): boolean {
    return status === 'pending_openai' || status === 'pending_audit';
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

async function postJson<T>(url: string, body?: unknown, includeCredentials = true): Promise<T> {
    const response = await fetch(url, {
        method: 'POST',
        credentials: includeCredentials ? 'include' : 'omit',
        headers: {
            ...getAuthHeaders(),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
        throw await readUGCError(response);
    }

    return response.json() as Promise<T>;
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
        const rawCode = payload.code || payload.error?.code || `HTTP_${response.status}`;
        const code = normalizeUGCErrorCode(rawCode, response.status);
        const message = payload.message || payload.error?.message || code;
        return new UGCClientError(message, code, response.status);
    } catch {
        return new UGCClientError(
            `HTTP ${response.status}`,
            normalizeUGCErrorCode(`HTTP_${response.status}`, response.status),
            response.status,
        );
    }
}

function normalizeUGCErrorCode(code: string, status?: number): string {
    if (status === 429 || code === 'RATE_LIMITED') return 'rateLimited';
    if (code === 'MIME_NOT_ALLOWED') return 'unsupportedType';
    if (code === 'UPLOAD_SIZE_INVALID') return 'fileTooLarge';
    if (code === 'IMAGE_PROCESSING_FAILED') return 'imageDecodeFailed';
    return code;
}

function uploadFormData<T>(
    url: string,
    formData: FormData,
    onProgress?: (progress: number) => void,
    onUploadSent?: () => void,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.withCredentials = true;

        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || !onProgress) return;
            onProgress(Math.min(0.98, Math.max(0, event.loaded / event.total)));
        };

        xhr.upload.onload = () => {
            onUploadSent?.();
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

import { createMarkerQueue, failedBatchMarkers, listByMarkerIds, runUGCBatches, type MarkerBatchPayload } from './batch';
import { UGCClientError } from './error';
import { ReadCache } from './readCache';
export { UGCClientError } from './error';
import { getAuthBase, getAuthHeaders } from '@/services/http/authRuntime';
import { requestJson as requestHttpJson } from '@/services/http/request';
import { MARKER_TYPE_DICT, type IMarkerData } from '@/data/marker';
import { buildPointShareToken } from '@/services/routing/share';

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

export type UGCCommentContext = {
    targetId: string;
    path: UGCComment[];
    replies: UGCComment[];
    repliesTruncated: boolean;
};

export async function getUGCCommentById(markerId: string, commentId: string): Promise<UGCCommentContext> {
    const search = new URLSearchParams({ markerId });
    const response = await fetch(
        `${UGC_API_BASE}/comments/${encodeURIComponent(commentId)}?${search.toString()}`,
        { credentials: 'include', headers: getAuthHeaders() },
    );
    if (!response.ok) throw await readUGCError(response);
    const payload = await response.json() as { item?: UGCCommentContext };
    if (!payload.item) throw new UGCClientError('Comment response is missing.', 'UGC_ERROR');
    return { ...payload.item, path: payload.item.path.map(normalizeUGCComment), replies: payload.item.replies.map(normalizeUGCComment) };
}

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

type SubmissionCacheEntry = {
    expiresAt: number;
    images: UGCSubmissionImage[];
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
const imageCache = new ReadCache<ImageCacheEntry>();
const publicImageCache = new ReadCache<ImageCacheEntry>();
const commentCache = new ReadCache<CommentCacheEntry>();
const submissionCache = new ReadCache<SubmissionCacheEntry>();

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
    return listByMarkerIds(markerIds, peekUGCImages, queueImages);
}

export async function listPublicUGCImagesByMarkerIds(markerIds: string[]): Promise<Record<string, UGCImage[]>> {
    return listByMarkerIds(markerIds, peekPublicUGCImages, queuePublicImages);
}

export async function listUGCCommentsByMarkerIds(markerIds: string[]): Promise<Record<string, UGCComment[]>> {
    return listByMarkerIds(markerIds, peekUGCComments, queueComments);
}

export async function listUGCMyImages(markerId: string): Promise<UGCSubmissionImage[]> {
    return listUGCMyImagesByMarkerIds([markerId]).then((grouped) => grouped[markerId] ?? []);
}

export type PointImageLists = { images?: UGCImage[]; myImages?: UGCSubmissionImage[] };

// Detail reads have zero private-result TTL, just like /images/mine. Public
// results keep their existing TTL; a warm public list only needs the mine read.
let pointImageAccount = { uid: '', pending: new Map<string, Promise<PointImageLists>>() };

export function listUGCPointImages(markerId: string, userId: string): Promise<PointImageLists> {
    if (pointImageAccount.uid !== userId) {
        imageCache.clear();
        pointImageAccount = { uid: userId, pending: new Map() };
    }
    const account = pointImageAccount;
    const pending = account.pending.get(markerId);
    if (pending) return pending;
    const hadCachedImages = peekUGCImages(markerId) !== null;
    const request = readPointImages(markerId).then((result) => {
        if (account === pointImageAccount && !hadCachedImages && result.images && result.myImages) {
            imageCache.set(markerId, {
                images: result.images,
                expiresAt: Date.now() + (result.images.length ? PRIVATE_IMAGE_CACHE_POSITIVE_TTL_MS : IMAGE_CACHE_EMPTY_TTL_MS),
            });
        }
        return result;
    }).finally(() => { account.pending.delete(markerId); });
    account.pending.set(markerId, request);
    return request;
}

async function readPointImages(markerId: string): Promise<PointImageLists> {
    const cached = peekUGCImages(markerId);
    if (cached) {
        const myImages = await listUGCMyImages(markerId).catch(() => undefined);
        return { images: cached, myImages };
    }
    const result: PointImageLists = {};
    let anonymous = false;
    await runUGCBatches([markerId], async () => {
        const scope = import.meta.env.DEV ? 'test' : 'prod';
        const search = new URLSearchParams({ markerId, scope, limit: '6', includeMine: '1' });
        const response = await fetch(`${UGC_API_BASE}/images?${search}`, {
            credentials: 'include', headers: getAuthHeaders(),
        });
        // Expired/suspended sessions can still view the public section.
        if (response.status === 401 || response.status === 403) {
            anonymous = true;
            return;
        }
        if (!response.ok) throw await readUGCError(response);
        const payload = await response.json() as {
            images: MarkerBatchPayload<UGCImage> & { error?: unknown };
            mine: { items?: UGCSubmissionImage[]; error?: unknown };
        };
        if (!payload.images.error && !failedBatchMarkers(payload.images, [markerId]).has(markerId)) {
            result.images = (payload.images.items ?? []).map(normalizeUGCImage);
        }
        if (!payload.mine.error) result.myImages = (payload.mine.items ?? []).map(normalizeUGCSubmissionImage);
        // Completed private results stay in the mounted detail, never in the
        // global public preview cache or a new cross-account result cache.
    });
    if (anonymous) return { images: await listPublicUGCImages(markerId) };
    return result;
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
    return listByMarkerIds(markerIds, peekUGCMyImages, queueSubmissions);
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

// Queue scheduling is shared; permissions, normalization and cache policy remain
// local to each resource. In particular, mine does not use public partial-result rules.
async function readMarkerBatch<T>(path: string, publicOnly = false): Promise<MarkerBatchPayload<T>> {
    const response = await fetch(`${UGC_API_BASE}${path}`, {
        credentials: publicOnly ? 'omit' : 'include',
        ...(publicOnly ? {} : { headers: getAuthHeaders() }),
    });
    if (!response.ok) throw await readUGCError(response);
    return response.json() as Promise<MarkerBatchPayload<T>>;
}

const batchScope = import.meta.env.DEV ? 'test' : 'prod';
const queueImages = createMarkerQueue<UGCImage>({
    read: (ids) => readMarkerBatch(`/images?markerIds=${encodeURIComponent(ids.join(','))}&limit=6&scope=${batchScope}`),
    normalize: normalizeUGCImage,
    store: (markerId, images) => imageCache.set(markerId, {
        expiresAt: Date.now() + (images.length ? PRIVATE_IMAGE_CACHE_POSITIVE_TTL_MS : IMAGE_CACHE_EMPTY_TTL_MS), images,
    }),
});
const queuePublicImages = createMarkerQueue<UGCImage>({
    read: (ids) => readMarkerBatch(`/images?markerIds=${encodeURIComponent(ids.join(','))}&limit=6&scope=${batchScope}&publicOnly=1`, true),
    normalize: normalizeUGCImage,
    store: (markerId, images) => publicImageCache.set(markerId, {
        expiresAt: Date.now() + (images.length ? PUBLIC_IMAGE_CACHE_POSITIVE_TTL_MS : IMAGE_CACHE_EMPTY_TTL_MS), images,
    }),
});
const queueComments = createMarkerQueue<UGCComment>({
    read: (ids) => readMarkerBatch(`/comments?markerIds=${encodeURIComponent(ids.join(','))}&limit=20&replyLimit=10&scope=${batchScope}`),
    normalize: normalizeUGCComment,
    store: (markerId, comments) => commentCache.set(markerId, {
        expiresAt: Date.now() + (comments.length ? COMMENT_CACHE_POSITIVE_TTL_MS : COMMENT_CACHE_EMPTY_TTL_MS), comments,
    }),
});
const queueSubmissions = createMarkerQueue<UGCSubmissionImage>({
    read: async (ids) => {
        const { items } = await readMarkerBatch<UGCSubmissionImage>(`/images/mine?markerIds=${encodeURIComponent(ids.join(','))}&limit=6&scope=${batchScope}`);
        return { items };
    },
    normalize: normalizeUGCSubmissionImage,
    store: (markerId, images) => submissionCache.set(markerId, {
        expiresAt: Date.now() + SUBMISSION_CACHE_TTL_MS, images,
    }),
});

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
    return requestHttpJson(
        url,
        '',
        {
            method: 'POST',
            credentials: includeCredentials ? 'include' : 'omit',
            headers: getAuthHeaders(),
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        readUGCError,
    );
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

import { getAuthBase } from '@/services/http/authRuntime';
import { requestJson as requestHttpJson } from '@/services/http/request';
import type { CloudProgress } from '@/store/progressSync';
import type { ProgressManifestPayload } from '@/services/progress/bitmap';

const PROGRESS_API_BASE = `${getAuthBase()}/progress/v1`;

type CloudProgressMeta = Pick<CloudProgress, 'revision' | 'markerIndexHash' | 'updatedAt'>;

export type CloudArchiveProgress = {
    revision: string;
    archiveIndexHash: string;
    updatedAt: number | null;
    archiveIds: string[];
};

type CloudArchiveProgressMeta = Pick<CloudArchiveProgress, 'revision' | 'archiveIndexHash' | 'updatedAt'>;

export type ArchiveProgressManifestPayload = {
    archiveIndexHash: string;
    archiveIds: string[];
};

export type ArchiveProgressSyncRequestPayload = {
    baseRevision: string;
    clientMutationId: string;
    archiveIndexHash: string;
    setArchiveIds: string[];
    clearArchiveIds: string[];
    updatedAt: number;
};

export type ProgressSyncRequestPayload = {
    baseRevision: string;
    clientMutationId: string;
    markerIndexHash: string;
    setPointIds: string[];
    clearPointIds: string[];
    updatedAt: number;
};

type ApiErrorPayload = {
    code?: string;
    message?: string;
    details?: unknown;
    current?: CloudProgress;
    error?: {
        code?: string;
        message?: string;
        details?: unknown;
    };
};

export class ProgressSyncError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: unknown;
    readonly current?: CloudProgress;

    constructor(message: string, options: { status: number; code: string; details?: unknown; current?: CloudProgress }) {
        super(message);
        this.name = 'ProgressSyncError';
        this.status = options.status;
        this.code = options.code;
        this.details = options.details;
        this.current = options.current;
    }
}

const readApiError = async (response: Response): Promise<ProgressSyncError> => {
    try {
        const payload = await response.json() as ApiErrorPayload;
        const code = payload.code || payload.error?.code || `HTTP_${response.status}`;
        const details = payload.details ?? payload.error?.details;
        const current = payload.current
            ?? (details && typeof details === 'object' && 'current' in details
                ? (details as { current?: CloudProgress }).current
                : undefined);
        return new ProgressSyncError(payload.message || payload.error?.message || code, {
            status: response.status,
            code,
            details,
            current,
        });
    } catch {
        return new ProgressSyncError(`HTTP ${response.status}`, {
            status: response.status,
            code: `HTTP_${response.status}`,
        });
    }
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    return requestHttpJson(PROGRESS_API_BASE, path, init, readApiError);
}

export const fetchCloudProgress = (
    markerIndexHash: string,
): Promise<{ progress: CloudProgress }> =>
    requestJson(`/state?markerIndexHash=${encodeURIComponent(markerIndexHash)}`);

export const registerProgressManifest = (
    payload: ProgressManifestPayload,
): Promise<{ ok: true; manifest: { markerIndexHash: string } }> =>
    requestJson('/manifest', {
        method: 'POST',
        body: JSON.stringify(payload),
    });

export const syncCloudProgress = (
    payload: ProgressSyncRequestPayload,
    options: { keepalive?: boolean } = {},
): Promise<{ ok: true; progress: CloudProgressMeta; unchanged?: boolean; idempotent?: boolean }> =>
    requestJson('/sync', {
        method: 'POST',
        body: JSON.stringify(payload),
        keepalive: options.keepalive,
    });

export const fetchCloudArchiveProgress = (
    archiveIndexHash: string,
): Promise<{ progress: CloudArchiveProgress }> =>
    requestJson(`/archive/state?archiveIndexHash=${encodeURIComponent(archiveIndexHash)}`);

export const registerArchiveProgressManifest = (
    payload: ArchiveProgressManifestPayload,
): Promise<{ ok: true; manifest: { archiveIndexHash: string } }> =>
    requestJson('/archive/manifest', {
        method: 'POST',
        body: JSON.stringify(payload),
    });

export const syncCloudArchiveProgress = (
    payload: ArchiveProgressSyncRequestPayload,
    options: { keepalive?: boolean } = {},
): Promise<{ ok: true; progress: CloudArchiveProgressMeta; unchanged?: boolean }> =>
    requestJson('/archive/sync', {
        method: 'POST',
        body: JSON.stringify(payload),
        keepalive: options.keepalive,
    });

export const fetchProgressStats = (
    markerIndexHash: string,
): Promise<{
    markerIndexHash: string;
    pointCount?: number;
    totalSyncedUsers: number;
    sampleSize: number;
    counts: string;
    updatedAt: number | null;
}> => requestJson(`/stats?markerIndexHash=${encodeURIComponent(markerIndexHash)}`, {
    credentials: 'omit',
});

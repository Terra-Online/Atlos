import { UGCClientError } from './error';

// Preserve the server's 100-marker contract while bounding concurrent batches
// across public images, personalized images, comments and private submissions.
const UGC_BATCH_SIZE = 100;
const UGC_BATCH_CONCURRENCY = 8;
let activeUGCBatches = 0;
const waitingUGCBatches: Array<() => void> = [];

export async function runUGCBatches<T>(
    requests: T[],
    run: (batch: T[]) => Promise<void>,
): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (let index = 0; index < requests.length; index += UGC_BATCH_SIZE) {
        const batch = requests.slice(index, index + UGC_BATCH_SIZE);
        jobs.push(
            (async () => {
                if (activeUGCBatches >= UGC_BATCH_CONCURRENCY) {
                    await new Promise<void>((resolve) =>
                        waitingUGCBatches.push(resolve),
                    );
                } else {
                    activeUGCBatches += 1;
                }
                try {
                    await run(batch);
                } finally {
                    const next = waitingUGCBatches.shift();
                    if (next) next();
                    else activeUGCBatches -= 1;
                }
            })(),
        );
    }
    await Promise.all(jobs);
}

export type MarkerBatchPayload<T> = {
    items?: T[];
    partial?: boolean;
    failedMarkerIds?: string[];
};

export function failedBatchMarkers<T extends { markerId: string }>(
    payload: MarkerBatchPayload<T>,
    markerIds: string[],
): Set<string> {
    if (
        Array.isArray(payload.failedMarkerIds) &&
        payload.failedMarkerIds.length > 0
    ) {
        return new Set(
            payload.failedMarkerIds.filter(
                (id) => typeof id === 'string' && markerIds.includes(id),
            ),
        );
    }
    // Older servers cannot identify failed markers. Nonempty results can still
    // be shown, but absent items in a partial response must not become negatives.
    const returned = new Set(
        (payload.items ?? []).map((item) => item.markerId),
    );
    return new Set(
        payload.partial === true
            ? markerIds.filter((id) => !returned.has(id))
            : [],
    );
}

type Pending<T> = {
    markerId: string;
    resolve: (items: T[]) => void;
    reject: (error: unknown) => void;
};

type Options<T> = {
    read: (markerIds: string[]) => Promise<MarkerBatchPayload<T>>;
    normalize: (item: T) => T;
    store: (markerId: string, items: T[]) => void;
};

export function createMarkerQueue<T extends { markerId: string }>(
    options: Options<T>,
): (markerId: string) => Promise<T[]> {
    const inFlight = new Map<string, Promise<T[]>>();
    let pending: Pending<T>[] = [];
    let timer: number | null = null;

    const readBatch = async (requests: Pending<T>[]) => {
        const markerIds = requests.map(({ markerId }) => markerId);
        try {
            const payload = await options.read(markerIds);
            const failed = failedBatchMarkers(payload, markerIds);
            const grouped = new Map(markerIds.map((id) => [id, [] as T[]]));
            (payload.items ?? []).map(options.normalize).forEach((item) => {
                grouped.get(item.markerId)?.push(item);
            });
            requests.forEach(({ markerId, resolve, reject }) => {
                if (failed.has(markerId)) {
                    reject(
                        new UGCClientError(
                            'Marker data could not be completely read.',
                            'partialResponse',
                        ),
                    );
                    return;
                }
                const items = grouped.get(markerId) ?? [];
                options.store(markerId, items);
                resolve(items);
            });
        } catch (error) {
            requests.forEach(({ reject }) => reject(error));
        }
    };

    return (markerId) => {
        const existing = inFlight.get(markerId);
        if (existing) return existing;
        const promise = new Promise<T[]>((resolve, reject) => {
            pending.push({ markerId, resolve, reject });
            if (timer !== null) return;
            timer = window.setTimeout(() => {
                timer = null;
                const requests = pending;
                pending = [];
                void runUGCBatches(requests, readBatch);
            }, 0);
        });
        const tracked = promise.finally(() => {
            inFlight.delete(markerId);
        });
        inFlight.set(markerId, tracked);
        return tracked;
    };
}

export async function listByMarkerIds<T>(
    markerIds: string[],
    peek: (markerId: string) => T[] | null,
    queue: (markerId: string) => Promise<T[]>,
): Promise<Record<string, T[]>> {
    const ids = [...new Set(markerIds.map((id) => id.trim()).filter(Boolean))];
    const result: Record<string, T[]> = {};
    const pending: string[] = [];
    ids.forEach((id) => {
        const cached = peek(id);
        if (cached !== null) result[id] = cached;
        else pending.push(id);
    });
    const entries = await Promise.all(
        pending.map(async (id) => [id, await queue(id)] as const),
    );
    entries.forEach(([id, items]) => {
        result[id] = items;
    });
    return result;
}

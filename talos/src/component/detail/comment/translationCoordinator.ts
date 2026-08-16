import md5 from 'blueimp-md5';
import {
    transUGCComments,
    type UGCComment,
    type UGCCommentTrans,
} from '@/services/ugc/client';

const ATTEMPT_STORAGE_KEY = 'oem:comment-translation-attempts:v1';
const MAX_ATTEMPTED_KEYS = 2_000;
const MAX_BATCH_SIZE = 100;
const TRANSLATION_CACHE_MISS = 'TRANSLATION_CACHE_MISS';

type TranslationComment = Pick<UGCComment, 'id' | 'content'>;
type TranslationPromise = Promise<UGCCommentTrans | undefined>;
type LiveAttemptPolicy = 'always' | 'once';

type Deferred = {
    promise: TranslationPromise;
    resolve: (value: UGCCommentTrans | undefined) => void;
    reject: (reason?: unknown) => void;
};

const cacheInFlight = new Map<string, TranslationPromise>();
const liveInFlight = new Map<string, TranslationPromise>();
let attemptedKeys: Set<string> | null = null;

export const normalizeCommentTranslationContent = (content: string): string => (
    content.normalize('NFC').trim().replace(/\s+/g, ' ')
);

const normalizeTargetLanguage = (targetLanguage: string): string => (
    targetLanguage.trim().replace('_', '-').toLowerCase()
);

export const getCommentTranslationKey = (
    comment: TranslationComment,
    targetLanguage: string,
): string => (
    `${encodeURIComponent(comment.id)}:${md5(normalizeCommentTranslationContent(comment.content))}:${normalizeTargetLanguage(targetLanguage)}`
);

const createDeferred = (): Deferred => {
    let resolve!: Deferred['resolve'];
    let reject!: Deferred['reject'];
    const promise = new Promise<UGCCommentTrans | undefined>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

const readAttemptedKeys = (): Set<string> => {
    if (attemptedKeys) return attemptedKeys;

    let storedKeys: string[] = [];
    try {
        const raw = window.sessionStorage.getItem(ATTEMPT_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
            storedKeys = parsed.filter((item): item is string => typeof item === 'string');
        }
    } catch {
        // The in-memory set still enforces the limit when storage is unavailable.
    }

    attemptedKeys = new Set(storedKeys.slice(-MAX_ATTEMPTED_KEYS));
    return attemptedKeys;
};

const persistAttemptedKeys = (keys: Set<string>): void => {
    try {
        window.sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify([...keys]));
    } catch {
        // Some browsers deny storage access; keep using the module-level set.
    }
};

const reserveLiveAttempt = (keys: Set<string>, key: string): boolean => {
    if (keys.has(key)) return false;

    keys.add(key);
    while (keys.size > MAX_ATTEMPTED_KEYS) {
        const oldestKey = keys.values().next().value;
        if (!oldestKey) break;
        keys.delete(oldestKey);
    }
    return true;
};

const startBatch = (
    pending: Array<{ comment: TranslationComment; deferred: Deferred; key: string }>,
    targetLanguage: string,
    cachedOnly: boolean,
    inFlight: Map<string, TranslationPromise>,
): void => {
    for (let index = 0; index < pending.length; index += MAX_BATCH_SIZE) {
        const batch = pending.slice(index, index + MAX_BATCH_SIZE);
        void transUGCComments(
            batch.map(({ comment }) => comment.id),
            targetLanguage,
            { cachedOnly },
        ).then((items) => {
            const itemById = new Map(items.map((item) => [item.commentId, item] as const));
            batch.forEach(({ comment, deferred }) => deferred.resolve(itemById.get(comment.id)));
        }).catch((error: unknown) => {
            batch.forEach(({ deferred }) => deferred.reject(error));
        }).finally(() => {
            batch.forEach(({ deferred, key }) => {
                if (inFlight.get(key) === deferred.promise) {
                    inFlight.delete(key);
                }
            });
        });
    }
};

const requestCachedTranslations = (
    comments: TranslationComment[],
    targetLanguage: string,
): Promise<Array<UGCCommentTrans | undefined>> => {
    const requests: TranslationPromise[] = [];
    const pending: Array<{ comment: TranslationComment; deferred: Deferred; key: string }> = [];

    comments.forEach((comment) => {
        const key = getCommentTranslationKey(comment, targetLanguage);
        const existing = cacheInFlight.get(key);
        if (existing) {
            requests.push(existing);
            return;
        }

        const deferred = createDeferred();
        cacheInFlight.set(key, deferred.promise);
        pending.push({ comment, deferred, key });
        requests.push(deferred.promise);
    });

    startBatch(pending, targetLanguage, true, cacheInFlight);
    return Promise.all(requests);
};

const requestLiveTranslations = (
    comments: TranslationComment[],
    targetLanguage: string,
    attemptPolicy: LiveAttemptPolicy,
): Promise<Array<UGCCommentTrans | undefined>> => {
    const requests: TranslationPromise[] = [];
    const pending: Array<{ comment: TranslationComment; deferred: Deferred; key: string }> = [];
    const keys = readAttemptedKeys();
    let attemptsChanged = false;

    comments.forEach((comment) => {
        const key = getCommentTranslationKey(comment, targetLanguage);
        const existing = liveInFlight.get(key);
        if (existing) {
            if (attemptPolicy === 'once' && reserveLiveAttempt(keys, key)) {
                attemptsChanged = true;
            }
            requests.push(existing);
            return;
        }
        if (attemptPolicy === 'once' && !reserveLiveAttempt(keys, key)) {
            requests.push(Promise.resolve(undefined));
            return;
        }
        if (attemptPolicy === 'once') attemptsChanged = true;

        const deferred = createDeferred();
        liveInFlight.set(key, deferred.promise);
        pending.push({ comment, deferred, key });
        requests.push(deferred.promise);
    });

    if (attemptsChanged) persistAttemptedKeys(keys);
    startBatch(pending, targetLanguage, false, liveInFlight);
    return Promise.all(requests);
};

export const requestCommentTranslations = async (
    comments: TranslationComment[],
    targetLanguage: string,
    options: {
        allowLive: boolean;
        liveAttemptPolicy: LiveAttemptPolicy;
    },
): Promise<UGCCommentTrans[]> => {
    if (comments.length === 0) return [];

    const cachedItems = await requestCachedTranslations(comments, targetLanguage);
    if (!options.allowLive) {
        return cachedItems.filter((item): item is UGCCommentTrans => Boolean(item));
    }

    const misses = comments.filter((_, index) => (
        cachedItems[index]?.error === TRANSLATION_CACHE_MISS
    ));
    if (misses.length === 0) {
        return cachedItems.filter((item): item is UGCCommentTrans => Boolean(item));
    }

    const liveItems = await requestLiveTranslations(
        misses,
        targetLanguage,
        options.liveAttemptPolicy,
    );
    const liveByKey = new Map(
        misses.map((comment, index) => (
            [getCommentTranslationKey(comment, targetLanguage), liveItems[index]] as const
        )),
    );

    return comments.flatMap((comment, index) => {
        const cachedItem = cachedItems[index];
        if (cachedItem?.error !== TRANSLATION_CACHE_MISS) {
            return cachedItem ? [cachedItem] : [];
        }
        const liveItem = liveByKey.get(getCommentTranslationKey(comment, targetLanguage));
        return liveItem ? [liveItem] : [cachedItem];
    });
};

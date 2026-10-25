import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UGCCommentTrans } from '@/services/ugc/client';

type TranslationMock = (
    commentIds: string[],
    targetLanguage: string,
    options: { cachedOnly?: boolean },
) => Promise<UGCCommentTrans[]>;

const transUGCCommentsMock = vi.hoisted(() => vi.fn<TranslationMock>());

vi.mock('@/services/ugc/client', () => ({
    transUGCComments: transUGCCommentsMock,
}));

const cacheMiss = (commentId: string, targetLanguage: string) => ({
    commentId,
    targetLanguage,
    provider: 'google_cloud_translation_v3',
    glossaryApplied: false,
    cached: false,
    error: 'TRANSLATION_CACHE_MISS',
});

const translated = (commentId: string, targetLanguage: string) => ({
    commentId,
    translatedContent: `translated:${commentId}`,
    sourceLanguage: 'en',
    targetLanguage,
    provider: 'google_cloud_translation_v3',
    glossaryApplied: true,
    cached: false,
});

describe('comment translation coordinator', () => {
    beforeEach(() => {
        vi.resetModules();
        transUGCCommentsMock.mockReset();
        window.sessionStorage.clear();
    });

    it('stops after the cache lookup when live translation is not allowed', async () => {
        transUGCCommentsMock.mockImplementation((
            commentIds: string[],
            targetLanguage: string,
        ) => Promise.resolve(commentIds.map((commentId) => cacheMiss(commentId, targetLanguage))));
        const { requestCommentTranslations } = await import('@/pages/detail/comment/translationCoordinator');

        const result = await requestCommentTranslations(
            [{ id: 'comment-1', content: 'Hello' }],
            'zh-cn',
            { allowLive: false, liveAttemptPolicy: 'once' },
        );

        expect(result).toEqual([cacheMiss('comment-1', 'zh-cn')]);
        expect(transUGCCommentsMock).toHaveBeenCalledOnce();
        expect(transUGCCommentsMock).toHaveBeenCalledWith(
            ['comment-1'],
            'zh-cn',
            { cachedOnly: true },
        );
    });

    it('runs one live request only after an explicit cache miss', async () => {
        transUGCCommentsMock.mockImplementation((
            commentIds: string[],
            targetLanguage: string,
            options: { cachedOnly?: boolean },
        ) => Promise.resolve(commentIds.map((commentId) => (
            options.cachedOnly
                ? cacheMiss(commentId, targetLanguage)
                : translated(commentId, targetLanguage)
        ))));
        const { requestCommentTranslations } = await import('@/pages/detail/comment/translationCoordinator');

        const result = await requestCommentTranslations(
            [{ id: 'comment-1', content: 'Hello' }],
            'zh-cn',
            { allowLive: true, liveAttemptPolicy: 'once' },
        );

        expect(result).toEqual([translated('comment-1', 'zh-cn')]);
        expect(transUGCCommentsMock).toHaveBeenCalledTimes(2);
        expect(transUGCCommentsMock).toHaveBeenNthCalledWith(
            1,
            ['comment-1'],
            'zh-cn',
            { cachedOnly: true },
        );
        expect(transUGCCommentsMock).toHaveBeenNthCalledWith(
            2,
            ['comment-1'],
            'zh-cn',
            { cachedOnly: false },
        );
    });

    it('does not turn non-cache errors into live translation requests', async () => {
        transUGCCommentsMock.mockResolvedValue([{
            commentId: 'comment-1',
            targetLanguage: 'zh-cn',
            provider: 'google_cloud_translation_v3',
            glossaryApplied: false,
            cached: false,
            error: 'COMMENT_NOT_TRANSLATABLE',
        }]);
        const { requestCommentTranslations } = await import('@/pages/detail/comment/translationCoordinator');

        await requestCommentTranslations(
            [{ id: 'comment-1', content: 'Hello' }],
            'zh-cn',
            { allowLive: true, liveAttemptPolicy: 'once' },
        );

        expect(transUGCCommentsMock).toHaveBeenCalledOnce();
    });

    it('merges concurrent cache and live requests for the same content key', async () => {
        let resolveCache!: (value: ReturnType<typeof cacheMiss>[]) => void;
        let resolveLive!: (value: ReturnType<typeof translated>[]) => void;
        const cachePromise = new Promise<ReturnType<typeof cacheMiss>[]>((resolve) => {
            resolveCache = resolve;
        });
        const livePromise = new Promise<ReturnType<typeof translated>[]>((resolve) => {
            resolveLive = resolve;
        });
        transUGCCommentsMock.mockImplementation((
            _commentIds: string[],
            _targetLanguage: string,
            options: { cachedOnly?: boolean },
        ) => options.cachedOnly ? cachePromise : livePromise);
        const { requestCommentTranslations } = await import('@/pages/detail/comment/translationCoordinator');
        const input = [{ id: 'comment-1', content: 'Hello' }];

        const first = requestCommentTranslations(input, 'zh-cn', {
            allowLive: true,
            liveAttemptPolicy: 'once',
        });
        const second = requestCommentTranslations(input, 'zh-cn', {
            allowLive: true,
            liveAttemptPolicy: 'once',
        });
        expect(transUGCCommentsMock).toHaveBeenCalledOnce();

        resolveCache([cacheMiss('comment-1', 'zh-cn')]);
        await vi.waitFor(() => expect(transUGCCommentsMock).toHaveBeenCalledTimes(2));
        resolveLive([translated('comment-1', 'zh-cn')]);

        await expect(first).resolves.toEqual([translated('comment-1', 'zh-cn')]);
        await expect(second).resolves.toEqual([translated('comment-1', 'zh-cn')]);
        expect(transUGCCommentsMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry a failed live attempt in the same session', async () => {
        transUGCCommentsMock.mockImplementation((
            commentIds: string[],
            targetLanguage: string,
            options: { cachedOnly?: boolean },
        ) => {
            if (options.cachedOnly) {
                return Promise.resolve(commentIds.map((commentId) => cacheMiss(commentId, targetLanguage)));
            }
            return Promise.reject(new Error('translation failed'));
        });
        const { requestCommentTranslations } = await import('@/pages/detail/comment/translationCoordinator');
        const input = [{ id: 'comment-1', content: 'Hello' }];

        await expect(requestCommentTranslations(input, 'zh-cn', {
            allowLive: true,
            liveAttemptPolicy: 'once',
        })).rejects.toThrow(
            'translation failed',
        );
        await expect(requestCommentTranslations(input, 'zh-cn', {
            allowLive: true,
            liveAttemptPolicy: 'once',
        })).resolves.toEqual([
            cacheMiss('comment-1', 'zh-cn'),
        ]);

        expect(transUGCCommentsMock).toHaveBeenCalledTimes(3);
        expect(transUGCCommentsMock.mock.calls.filter((call) => !call[2]?.cachedOnly)).toHaveLength(1);
    });

    it('allows a manual retry after a failed live attempt', async () => {
        let liveAttempts = 0;
        transUGCCommentsMock.mockImplementation((
            commentIds: string[],
            targetLanguage: string,
            options: { cachedOnly?: boolean },
        ) => {
            if (options.cachedOnly) {
                return Promise.resolve(commentIds.map((commentId) => cacheMiss(commentId, targetLanguage)));
            }
            liveAttempts += 1;
            return liveAttempts === 1
                ? Promise.reject(new Error('temporary failure'))
                : Promise.resolve(commentIds.map((commentId) => translated(commentId, targetLanguage)));
        });
        const { requestCommentTranslations } = await import('@/pages/detail/comment/translationCoordinator');
        const input = [{ id: 'comment-1', content: 'Hello' }];
        const manual = { allowLive: true, liveAttemptPolicy: 'always' } as const;

        await expect(requestCommentTranslations(input, 'zh-hk', manual)).rejects.toThrow('temporary failure');
        await expect(requestCommentTranslations(input, 'zh-hk', manual)).resolves.toEqual([
            translated('comment-1', 'zh-hk'),
        ]);

        expect(liveAttempts).toBe(2);
    });

    it('allows a new live attempt for changed content or target language', async () => {
        transUGCCommentsMock.mockImplementation((
            commentIds: string[],
            targetLanguage: string,
            options: { cachedOnly?: boolean },
        ) => Promise.resolve(commentIds.map((commentId) => (
            options.cachedOnly
                ? cacheMiss(commentId, targetLanguage)
                : translated(commentId, targetLanguage)
        ))));
        const { requestCommentTranslations } = await import('@/pages/detail/comment/translationCoordinator');

        const once = { allowLive: true, liveAttemptPolicy: 'once' } as const;
        await requestCommentTranslations([{ id: 'comment-1', content: 'Hello' }], 'zh-cn', once);
        await requestCommentTranslations([{ id: 'comment-1', content: 'Hello' }], 'zh-cn', once);
        await requestCommentTranslations([{ id: 'comment-1', content: 'Edited' }], 'zh-cn', once);
        await requestCommentTranslations([{ id: 'comment-1', content: 'Edited' }], 'ja-jp', once);

        expect(transUGCCommentsMock.mock.calls.filter((call) => !call[2]?.cachedOnly)).toHaveLength(3);
    });

    it('keeps only the latest 2,000 attempted keys', async () => {
        transUGCCommentsMock.mockImplementation((
            commentIds: string[],
            targetLanguage: string,
            options: { cachedOnly?: boolean },
        ) => Promise.resolve(commentIds.map((commentId) => (
            options.cachedOnly
                ? cacheMiss(commentId, targetLanguage)
                : translated(commentId, targetLanguage)
        ))));
        const {
            getCommentTranslationKey,
            requestCommentTranslations,
        } = await import('@/pages/detail/comment/translationCoordinator');
        const comments = Array.from({ length: 2_001 }, (_, index) => ({
            id: `comment-${index}`,
            content: `Content ${index}`,
        }));

        await requestCommentTranslations(comments, 'zh-cn', {
            allowLive: true,
            liveAttemptPolicy: 'once',
        });

        const stored = JSON.parse(
            window.sessionStorage.getItem('oem:comment-translation-attempts:v1') ?? '[]',
        ) as string[];
        expect(stored).toHaveLength(2_000);
        expect(stored).not.toContain(getCommentTranslationKey(comments[0], 'zh-cn'));
        expect(stored).toContain(getCommentTranslationKey(comments[2_000], 'zh-cn'));
    });
});

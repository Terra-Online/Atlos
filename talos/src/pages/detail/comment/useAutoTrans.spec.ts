import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import type { UGCComment } from '@/services/ugc/client';
import { useAutoTrans } from '@/pages/detail/comment/useAutoTrans';

const requestCommentTranslationsMock = vi.hoisted(() => vi.fn());

vi.mock('@/pages/detail/comment/translationCoordinator', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/pages/detail/comment/translationCoordinator')>();
    return {
        ...original,
        requestCommentTranslations: requestCommentTranslationsMock,
    };
});

const comments: UGCComment[] = [{
    id: 'comment-1',
    markerId: 'marker-1',
    parentId: null,
    depth: 0,
    content: 'Hello',
    createdAt: '2026-07-29T00:00:00.000Z',
    score: 0,
    status: 'active',
    replyCount: 0,
    replies: [],
}];

describe('automatic comment translation authentication', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        requestCommentTranslationsMock.mockReset();
        requestCommentTranslationsMock.mockResolvedValue([]);
        useAuthStore.setState({ sessionUser: null });
    });

    it('uses cache only for guests and enables one live path after login', async () => {
        const setComments = vi.fn();
        renderHook(() => useAutoTrans({
            comments,
            locale: 'zh-CN',
            scopeKey: 'marker-1',
            setComments,
        }));

        await waitFor(() => expect(requestCommentTranslationsMock).toHaveBeenCalledTimes(1));
        expect(requestCommentTranslationsMock).toHaveBeenNthCalledWith(
            1,
            comments,
            'zh-cn',
            { allowLive: false, liveAttemptPolicy: 'once' },
        );

        act(() => {
            useAuthStore.setState({
                sessionUser: { uid: 'user-1', nickname: 'User' },
            });
        });

        await waitFor(() => expect(requestCommentTranslationsMock).toHaveBeenCalledTimes(2));
        expect(requestCommentTranslationsMock).toHaveBeenNthCalledWith(
            2,
            comments,
            'zh-cn',
            { allowLive: true, liveAttemptPolicy: 'once' },
        );
    });

    it('keeps the Traditional Chinese fallback cache-only for registered users', async () => {
        useAuthStore.setState({
            sessionUser: { uid: 'user-1', nickname: 'User' },
        });
        const setComments = vi.fn();
        renderHook(() => useAutoTrans({
            comments,
            locale: 'zh-HK',
            scopeKey: 'marker-1',
            setComments,
        }));

        await waitFor(() => expect(requestCommentTranslationsMock).toHaveBeenCalledOnce());
        expect(requestCommentTranslationsMock).toHaveBeenCalledWith(
            comments,
            'zh-cn',
            { allowLive: false, liveAttemptPolicy: 'once' },
        );
    });

    it('preserves an unchanged nested comment tree during Traditional Chinese cleanup', async () => {
        const nestedComments: UGCComment[] = [{
            ...comments[0],
            replyCount: 1,
            replies: [{
                ...comments[0],
                id: 'comment-2',
                parentId: 'comment-1',
                depth: 1,
            }],
        }];

        const { result } = renderHook(() => {
            const [current, setCurrent] = useState(nestedComments);
            useAutoTrans({
                comments: current,
                locale: 'zh-HK',
                scopeKey: 'marker-1',
                setComments: setCurrent,
            });
            return current;
        });

        await waitFor(() => expect(requestCommentTranslationsMock).toHaveBeenCalledOnce());
        expect(result.current).toBe(nestedComments);
    });
});

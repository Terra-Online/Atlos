import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    OEM_AUTH_DISMISS_EVENT,
    OEM_AUTH_OPEN_EVENT,
    type OemAuthOpenDetail,
} from '@/component/shared/account/authEvents';
import type { UGCComment } from '@/services/ugc/client';
import { useTrans } from '@/pages/detail/comment/useTrans';

const requestCommentTranslationsMock = vi.hoisted(() => vi.fn());

vi.mock('@/pages/detail/comment/translationCoordinator', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/pages/detail/comment/translationCoordinator')>();
    return {
        ...original,
        requestCommentTranslations: requestCommentTranslationsMock,
    };
});

const comment = (content = 'Hello'): UGCComment => ({
    id: 'comment-1',
    markerId: 'marker-1',
    parentId: null,
    depth: 0,
    content,
    createdAt: '2026-07-29T00:00:00.000Z',
    score: 0,
    status: 'active',
    replyCount: 0,
    replies: [],
});

const hookProps = (comments: UGCComment[], isAuthenticated: boolean) => ({
    locale: 'zh-CN',
    comments,
    busyIds: new Set<string>(),
    isAuthenticated,
    patch: vi.fn(),
    scopeKey: 'marker-1',
    setBusy: vi.fn(),
    setComments: vi.fn(),
    setReply: vi.fn(),
    setRendered: vi.fn(),
});

describe('manual comment translation authentication', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        requestCommentTranslationsMock.mockReset();
        requestCommentTranslationsMock.mockResolvedValue([]);
        window.sessionStorage.clear();
    });

    it('opens login without requesting translation and resumes after login', async () => {
        const comments = [comment()];
        const authOpen = vi.fn();
        window.addEventListener(OEM_AUTH_OPEN_EVENT, authOpen);
        const initialProps = hookProps(comments, false);
        const { result, rerender } = renderHook(
            (props) => useTrans(props),
            { initialProps },
        );

        act(() => result.current(comments[0]));

        expect(requestCommentTranslationsMock).not.toHaveBeenCalled();
        expect(authOpen).toHaveBeenCalledOnce();
        expect((authOpen.mock.calls[0][0] as CustomEvent<OemAuthOpenDetail>).detail).toEqual({ mode: 'login' });

        rerender({ ...initialProps, isAuthenticated: true });
        await waitFor(() => expect(requestCommentTranslationsMock).toHaveBeenCalledOnce());
        expect(requestCommentTranslationsMock).toHaveBeenCalledWith(
            [comments[0]],
            'zh-cn',
            { allowLive: true, liveAttemptPolicy: 'always' },
        );
        window.removeEventListener(OEM_AUTH_OPEN_EVENT, authOpen);
    });

    it('cancels the pending translation when the auth modal is dismissed', async () => {
        const comments = [comment()];
        const initialProps = hookProps(comments, false);
        const { result, rerender } = renderHook(
            (props) => useTrans(props),
            { initialProps },
        );

        act(() => result.current(comments[0]));
        act(() => {
            window.dispatchEvent(new Event(OEM_AUTH_DISMISS_EVENT));
        });
        rerender({ ...initialProps, isAuthenticated: true });

        await act(async () => Promise.resolve());
        expect(requestCommentTranslationsMock).not.toHaveBeenCalled();
    });

    it('cancels the pending translation when the comment content changes', async () => {
        const comments = [comment()];
        const initialProps = hookProps(comments, false);
        const { result, rerender } = renderHook(
            (props) => useTrans(props),
            { initialProps },
        );

        act(() => result.current(comments[0]));
        rerender({
            ...initialProps,
            comments: [comment('Edited while login was open')],
            isAuthenticated: true,
        });

        await act(async () => Promise.resolve());
        expect(requestCommentTranslationsMock).not.toHaveBeenCalled();
    });

    it('uses zh-hk and the retryable live policy for manual translation on Traditional Chinese pages', async () => {
        const comments = [comment('简体中文')];
        const props = {
            ...hookProps(comments, true),
            locale: 'zh-HK',
        };
        const { result } = renderHook(() => useTrans(props));

        act(() => result.current(comments[0]));

        await waitFor(() => expect(requestCommentTranslationsMock).toHaveBeenCalledOnce());
        expect(requestCommentTranslationsMock).toHaveBeenCalledWith(
            [comments[0]],
            'zh-hk',
            { allowLive: true, liveAttemptPolicy: 'always' },
        );
    });
});

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { IMarkerData } from '@/data/marker';
import type { UGCComment } from '@/utils/ugcClient';

const localeState = vi.hoisted(() => ({ current: 'en-US' }));

vi.mock('@/assets/logos/translater.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/like.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/flag.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/recall.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/logos/submit.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/logos/reply.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/edit.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/share.svg?react', () => ({ default: () => null }));
vi.mock('progressive-blur', () => ({ LinearBlur: () => null }));
vi.mock('@/component/login/authFlow', () => ({ getAuthBase: () => '', getAuthHeaders: () => ({}) }));
vi.mock('@/store/auth', () => ({ useAuthStore: () => null }));
vi.mock('@/data/marker', () => ({ MARKER_TYPE_DICT: {} }));
vi.mock('@/utils/urlState', () => ({ generatePointShareUrl: (_: unknown, options: { content: { id: string } }) => `https://oem.re/marker?commentId=${options.content.id}` }));
vi.mock('@/locale', () => {
    const translate = (key: string) => key === 'detail.comments.loadFailed'
        ? `${localeState.current}:${key}`
        : key;
    return { useTranslateUI: () => translate, useLocale: () => localeState.current, getProjectLangNameKey: () => '' };
});
vi.mock('@/store/marker', async () => {
    const { create } = await import('zustand');
    return {
        useMarkerStore: create((set) => ({
            commentOpenRequest: null,
            clearCommentOpenRequest: () => set({ commentOpenRequest: null }),
        })),
    };
});
vi.mock('./useAutoTrans', () => ({ useAutoTrans: () => {} }));
vi.mock('./useTrans', () => ({ useTrans: () => vi.fn() }));

import Comments from './Comments';
import * as client from '@/utils/ugcClient';
import { useMarkerStore } from '@/store/marker';

const point = { id: '1', type: 'test', subregId: 'sub' } as IMarkerData;
const comment: UGCComment = { id: 'reply', markerId: '1', content: 'A shareable comment', parentId: null, depth: 0, createdAt: '', score: 0, replyCount: 0, replies: [], status: 'active' };
let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
    localeState.current = 'en-US';
    useMarkerStore.setState({ commentOpenRequest: null });
    vi.spyOn(client, 'listUGCComments').mockResolvedValue([comment]);
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['mouse', 'touch'])('allows anonymous sharing from the %s toolbar', async pointerType => {
    render(createElement(Comments, { point, pointName: 'Marker' }));
    const text = await screen.findByText(comment.content);
    const root = text.closest('article');
    if (!root) throw new Error('Comment article missing');
    const toolbar = await screen.findByRole('toolbar');
    const event = new Event(pointerType === 'touch' ? 'pointerdown' : 'pointerenter', { bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    fireEvent(root, event);
    expect(toolbar.dataset.open).toBe('true');
    const share = await screen.findByRole('button', { name: 'detail.comments.copyLink' });
    fireEvent.click(share);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://oem.re/marker?commentId=reply'));
    await screen.findByRole('button', { name: 'detail.copied' });
});

it('keeps copy failures silent without removing comments', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(createElement(Comments, { point, pointName: 'Marker' }));
    fireEvent.click(await screen.findByRole('button', { name: 'detail.comments.copyLink' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'detail.comments.copyLink' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'detail.comments.copyFailed' })).toBeNull();
    expect(screen.getByText(comment.content)).toBeTruthy();
});

it('disables sharing of a pending comment', async () => {
    vi.mocked(client.listUGCComments).mockResolvedValue([{ ...comment, status: 'pending_audit' }]);
    render(createElement(Comments, { point, pointName: 'Marker' }));
    const share = await screen.findByRole('button', { name: 'detail.comments.copyLink' });
    expect((share as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(share);
    expect(writeText).not.toHaveBeenCalled();
});

it('keeps a linked comment loaded when the locale changes', async () => {
    vi.mocked(client.listUGCComments).mockResolvedValue([]);
    vi.spyOn(client, 'getUGCCommentById').mockResolvedValue({
        targetId: comment.id,
        path: [comment],
        replies: [],
        repliesTruncated: false,
    });
    useMarkerStore.setState({ commentOpenRequest: { markerId: point.id, commentId: comment.id } });

    const { rerender } = render(createElement(Comments, { point, pointName: 'Marker' }));
    await screen.findByText(comment.content);
    await waitFor(() => expect(useMarkerStore.getState().commentOpenRequest).toBeNull());

    localeState.current = 'zh-CN';
    rerender(createElement(Comments, { point, pointName: 'Marker' }));

    await waitFor(() => expect(client.listUGCComments).toHaveBeenCalledTimes(1));
    expect(screen.getByText(comment.content)).toBeTruthy();
});

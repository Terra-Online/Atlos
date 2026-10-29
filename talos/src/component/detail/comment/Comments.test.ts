import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { IMarkerData } from '@/data/marker';
import type { UGCComment } from '@/services/ugc/client';

vi.mock('@/assets/logos/hideUI.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/format/bold.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/format/italic.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/format/underline.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/format/strike.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/format/code.svg?react', () => ({ default: () => null }));

const localeState = vi.hoisted(() => ({ current: 'en-US' }));

vi.mock('@/assets/logos/translater.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/like.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/flag.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/recall.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/logos/submit.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/logos/emoji.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/logos/reply.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/edit.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/share.svg?react', () => ({ default: () => null }));
vi.mock('progressive-blur', () => ({ LinearBlur: () => null }));
vi.mock('@/services/http/authRuntime', () => ({ getAuthBase: () => '', getAuthHeaders: () => ({}) }));
vi.mock('@/store/auth', async () => {
    const { create } = await import('zustand');
    return {
        useAuthStore: create(() => ({ sessionUser: null, sessionVersion: 0 })),
    };
});
vi.mock('@/data/marker', () => ({ MARKER_TYPE_DICT: {} }));
vi.mock('@/services/routing', () => ({ generatePointShareUrl: (_: unknown, options: { content: { id: string } }) => `https://oem.re/marker?commentId=${options.content.id}` }));
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
import * as client from '@/services/ugc/client';
import { useMarkerStore } from '@/store/marker';
import { useAuthStore } from '@/store/auth';
import { restoreCommentSubmission, getCommentSubmissionSnapshot } from './commentSubmissionStore';

const point = { id: '1', type: 'test', subregId: 'sub' } as IMarkerData;
const comment: UGCComment = { id: 'reply', markerId: '1', content: 'A shareable comment', parentId: null, depth: 0, createdAt: '', score: 0, replyCount: 0, replies: [], status: 'active' };
let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
    localeState.current = 'en-US';
    useMarkerStore.setState({ commentOpenRequest: null });
    vi.spyOn(client, 'listUGCComments').mockResolvedValue([comment]);
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('DragEvent', class extends Event {});
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
    await screen.findByRole('button', { name: 'common.copied' });
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

it('opens the emoji picker after a hover delay with 38 choices', () => {
    vi.useFakeTimers();
    try {
        render(createElement(Comments, { point, pointName: 'Marker' }));
        const button = screen.getByRole('button', { name: 'detail.comments.emojiPicker' });
        const root = button.parentElement;
        if (!root) throw new Error('Emoji picker root missing');

        fireEvent.pointerEnter(root);
        expect(screen.queryByRole('grid')).toBeNull();
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(screen.getByRole('grid')).toBeTruthy();
        expect(screen.getAllByRole('gridcell')).toHaveLength(38);
    } finally {
        vi.useRealTimers();
    }
});

it('renders a selected emoji inline and keeps the comment submit enabled', async () => {
    render(createElement(Comments, { point, pointName: 'Marker' }));
    const input = await screen.findByRole('textbox');

    fireEvent.click(screen.getByRole('button', { name: 'detail.comments.emojiPicker' }));
    const emoji = screen.getAllByRole('gridcell')[0];
    fireEvent.click(emoji);

    await waitFor(() => {
        expect(input.querySelector('img[alt=":sns_001:"]')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'detail.comments.submit' }).getAttribute('disabled')).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'detail.comments.emojiPicker' }).getAttribute('aria-haspopup')).toBe('grid');
});

it('keeps the emoji picker open while selecting multiple emojis', async () => {
    render(createElement(Comments, { point, pointName: 'Marker' }));
    await screen.findByRole('textbox');

    fireEvent.click(screen.getByRole('button', { name: 'detail.comments.emojiPicker' }));
    const choices = screen.getAllByRole('gridcell');
    fireEvent.click(choices[0]);
    fireEvent.click(choices[1]);

    expect(screen.getByRole('grid')).toBeTruthy();
    await waitFor(() => {
        expect(screen.getByRole('textbox').querySelectorAll('img')).toHaveLength(2);
    });
});

it('plays the picker close animation before unmounting it', () => {
    vi.useFakeTimers();
    try {
        render(createElement(Comments, { point, pointName: 'Marker' }));
        const button = screen.getByRole('button', { name: 'detail.comments.emojiPicker' });
        const root = button.parentElement;
        if (!root) throw new Error('Emoji picker root missing');

        fireEvent.click(button);
        expect(screen.getByRole('grid').getAttribute('data-open')).toBe('true');

        fireEvent.pointerLeave(root);
        act(() => {
            vi.advanceTimersByTime(120);
        });
        expect(screen.getByRole('grid', { hidden: true }).getAttribute('data-open')).toBe('false');

        act(() => {
            vi.advanceTimersByTime(180);
        });
        expect(screen.queryByRole('grid', { hidden: true })).toBeNull();
    } finally {
        vi.useRealTimers();
    }
});

it('parses markdown and emoji in pasted comment text', async () => {
    render(createElement(Comments, { point, pointName: 'Marker' }));
    const input = await screen.findByRole('textbox');
    const pasted = '**bold** *italic* __underline__ ~~strike~~ `code` [link](https://example.com) :sns_011:';
    const clipboardData = {
        getData: (type: string) => type === 'text/plain' ? pasted : '',
    };

    userEvent.click(input);
    fireEvent.paste(input, { clipboardData });

    await waitFor(() => {
        expect(input.querySelector('strong')?.textContent).toBe('bold');
        expect(input.querySelector('em')?.textContent).toBe('italic');
        expect(input.querySelector('[class*="commentEditorUnderline"]')?.textContent).toBe('underline');
        expect(input.querySelector('[class*="commentEditorStrikethrough"]')?.textContent).toBe('strike');
        expect(input.querySelector('code')?.textContent).toBe('code');
        expect(input.querySelector('a[href="https://example.com"]')?.textContent).toBe('link');
        expect(input.querySelector('img[alt=":sns_011:"]')).toBeTruthy();
    });
});

it('renders emoji tokens in loaded comments', async () => {
    vi.mocked(client.listUGCComments).mockResolvedValue([{
        ...comment,
        content: 'Hello :sns_011: :unknown: ***bold italic***',
    }]);
    render(createElement(Comments, { point, pointName: 'Marker' }));

    expect(await screen.findByRole('img', { name: ':sns_011:' })).toBeTruthy();
    expect(screen.getByText(/Hello/)).toBeTruthy();
    expect(screen.getByText(/:unknown:/)).toBeTruthy();
    expect(screen.getByText('bold italic').closest('strong')?.querySelector('em')).toBeTruthy();
});

it('replaces a mounted owner overlay with the public read after sign-out', async () => {
    useAuthStore.setState({ sessionUser: { uid: 'owner', nickname: 'Owner' } });
    vi.mocked(client.listUGCComments).mockResolvedValueOnce([{ ...comment, snapshotId: 'B', content: 'Private owner B', status: 'pending_audit' }]);
    render(createElement(Comments, { point, pointName: 'Point', active: true }));
    await screen.findByText('Private owner B');
    vi.mocked(client.listUGCComments).mockResolvedValueOnce([{ ...comment, snapshotId: 'A', content: 'Published A' }]);
    act(() => useAuthStore.setState({ sessionUser: null }));
    await screen.findByText('Published A');
    expect(screen.queryByText('Private owner B')).toBeNull();
});

it('clears a locally retained private submission when its account signs out', async () => {
    useAuthStore.setState({ sessionUser: { uid: 'owner', nickname: 'Owner' } });
    vi.mocked(client.listUGCComments).mockResolvedValue([]);
    restoreCommentSubmission(point.id, {
        ...comment,
        id: 'private-local',
        snapshotId: 'B',
        content: 'Private retained B',
        status: 'pending_audit',
    });
    render(
        createElement(Comments, { point, pointName: 'Point', active: true }),
    );
    await screen.findByText('Private retained B');
    act(() => useAuthStore.setState({ sessionUser: null }));
    await waitFor(() =>
        expect(screen.queryByText('Private retained B')).toBeNull(),
    );
});


it.each(['pending_openai', 'pending_audit', 'stale'] as const)(
    'does not offer editing for an owner %s version',
    async (status) => {
        useAuthStore.setState({
            sessionUser: { uid: 'owner', nickname: 'Owner' },
        });
        vi.mocked(client.listUGCComments).mockResolvedValue([
            {
                ...comment,
                snapshotId: 'A',
                status,
                author: { publicUid: 'owner', nickname: 'Owner' },
            },
        ]);
        render(
            createElement(Comments, {
                point,
                pointName: 'Point',
                active: true,
            }),
        );
        expect(
            (
                await screen.findByRole('button', {
                    name: 'detail.comments.edit',
                })
            ).hasAttribute('disabled'),
        ).toBe(true);
    },
);

it('does not edit an unsaved entry without a baseline', async () => {
    useAuthStore.setState({ sessionUser: { uid: 'owner', nickname: 'Owner' } });
    vi.mocked(client.listUGCComments).mockResolvedValue([
        { ...comment, author: { publicUid: 'owner', nickname: 'Owner' } },
    ]);
    render(
        createElement(Comments, { point, pointName: 'Point', active: true }),
    );
    expect(
        (
            await screen.findByRole('button', { name: 'detail.comments.edit' })
        ).hasAttribute('disabled'),
    ).toBe(true);
});

it('submits the baseline captured at editor open, rolls back a conflict and loads the actual new body', async () => {
    useAuthStore.setState({ sessionUser: { uid: 'owner', nickname: 'Owner' } });
    const published = {
        ...comment,
        snapshotId: 'A',
        author: { publicUid: 'owner', nickname: 'Owner' },
    };
    vi.mocked(client.listUGCComments).mockResolvedValueOnce([published]);
    const edit = vi
        .spyOn(client, 'editUGCComment')
        .mockRejectedValue(
            new client.UGCClientError('Changed', 'COMMENT_EDIT_CONFLICT', 409),
        );
    const invalidate = vi.spyOn(client, 'invalidateUGCCommentCache');
    render(
        createElement(Comments, { point, pointName: 'Point', active: true }),
    );
    fireEvent.click(
        await screen.findByRole('button', { name: 'detail.comments.edit' }),
    );
    const input = await screen.findByRole('textbox');
    await waitFor(() => expect(input.textContent).toContain(comment.content));
    userEvent.click(input);
    fireEvent.paste(input, {
        clipboardData: {
            getData: (type: string) =>
                type === 'text/plain' ? ' changed draft' : '',
        },
    });
    await waitFor(() => expect(input.textContent).toContain('changed draft'));
    vi.spyOn(client, 'getUGCCommentById').mockResolvedValue({
        targetId: 'new-child',
        path: [
            {
                ...published,
                snapshotId: 'B',
                content: 'Changed during editing B',
            },
            { ...comment, id: 'new-child', parentId: comment.id },
        ],
        replies: [],
        repliesTruncated: false,
    });
    act(() =>
        useMarkerStore.setState({
            commentOpenRequest: { markerId: point.id, commentId: 'new-child' },
        }),
    );
    await screen.findByText('Changed during editing B');
    vi.mocked(client.listUGCComments).mockResolvedValueOnce([
        { ...published, snapshotId: 'C', content: 'Actual current C' },
    ]);
    fireEvent.click(
        screen.getByRole('button', { name: 'detail.comments.submitEdit' }),
    );
    await screen.findByText('Actual current C');
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0]).toEqual([
        comment.id,
        expect.stringContaining('changed draft'),
        'A',
    ]);
    expect(invalidate).toHaveBeenCalledWith(point.id);
    expect(screen.getByText('detail.comments.editConflict')).toBeTruthy();
    expect(input.textContent).toBe('');
    expect(
        screen.queryByRole('button', { name: 'detail.comments.submitEdit' }),
    ).toBeNull();
});

it('validates an unchanged edit on the server and keeps the committed body and identity with replies and reactions', async () => {
    useAuthStore.setState({
        sessionUser: { uid: 'editor-owner', nickname: 'Owner' },
    });
    const published: UGCComment = {
        ...comment,
        snapshotId: 'A',
        author: { publicUid: 'editor-owner', nickname: 'Owner' },
        flagged: true,
        score: 7,
        viewerVote: 1,
        replyCount: 1,
        replies: [
            {
                ...comment,
                id: 'child',
                snapshotId: 'child-A',
                content: 'Keep this reply',
            },
        ],
    };
    vi.mocked(client.listUGCComments).mockResolvedValue([published]);
    const edit = vi.spyOn(client, 'editUGCComment').mockResolvedValue({
        id: comment.id,
        markerId: point.id,
        snapshotId: 'A',
        parentId: null,
        depth: 0,
        status: 'flagged',
    });
    render(
        createElement(Comments, { point, pointName: 'Point', active: true }),
    );
    fireEvent.click(
        await screen.findByRole('button', { name: 'detail.comments.edit' }),
    );
    await waitFor(() =>
        expect(screen.getByRole('textbox').textContent).toBe(comment.content),
    );
    fireEvent.click(
        screen.getByRole('button', { name: 'detail.comments.submitEdit' }),
    );
    await waitFor(() =>
        expect(edit).toHaveBeenCalledExactlyOnceWith(
            comment.id,
            comment.content,
            'A',
        ),
    );
    await waitFor(() =>
        expect(
            getCommentSubmissionSnapshot(point.id).comments[0],
        ).toMatchObject({
            snapshotId: 'A',
            content: comment.content,
            flagged: true,
            status: 'flagged',
            score: 7,
            viewerVote: 1,
            replyCount: 1,
            replies: [{ id: 'child' }],
        }),
    );
    expect(screen.getByText('Keep this reply')).toBeTruthy();
});

it('pairs an appended body with the returned snapshot and preserves its replies and reactions', async () => {
    useAuthStore.setState({
        sessionUser: { uid: 'append-owner', nickname: 'Owner' },
    });
    vi.mocked(client.listUGCComments).mockResolvedValue([
        {
            ...comment,
            snapshotId: 'A',
            author: { publicUid: 'append-owner', nickname: 'Owner' },
            flagged: true,
            score: 7,
            viewerVote: 1,
            replyCount: 1,
            replies: [
                {
                    ...comment,
                    id: 'child',
                    snapshotId: 'child-A',
                    content: 'Preserved reply',
                },
            ],
        },
    ]);
    let commit!: (submission: client.UGCCommentSubmission) => void;
    vi.spyOn(client, 'editUGCComment').mockImplementation(
        () =>
            new Promise((resolve) => {
                commit = resolve;
            }),
    );
    render(
        createElement(Comments, { point, pointName: 'Point', active: true }),
    );
    fireEvent.click(
        await screen.findByRole('button', { name: 'detail.comments.edit' }),
    );
    const input = await screen.findByRole('textbox');
    await waitFor(() => expect(input.textContent).toContain(comment.content));
    userEvent.click(input);
    fireEvent.paste(input, {
        clipboardData: {
            getData: (type: string) =>
                type === 'text/plain' ? ' new draft' : '',
        },
    });
    await waitFor(() => expect(input.textContent).toContain('new draft'));
    fireEvent.click(
        screen.getByRole('button', { name: 'detail.comments.submitEdit' }),
    );
    expect(
        getCommentSubmissionSnapshot(point.id).comments[0].snapshotId,
    ).toBeUndefined();
    await act(async () => {
        commit({
            id: comment.id,
            markerId: point.id,
            snapshotId: 'B',
            parentId: null,
            depth: 0,
            status: 'pending_openai',
        });
        await Promise.resolve();
    });
    expect(getCommentSubmissionSnapshot(point.id).comments[0]).toMatchObject({
        snapshotId: 'B',
        flagged: true,
        score: 7,
        viewerVote: 1,
        replyCount: 1,
        replies: [{ id: 'child' }],
    });
    expect(
        getCommentSubmissionSnapshot(point.id).comments[0].content,
    ).toContain('new draft');
    expect(
        getCommentSubmissionSnapshot(point.id).comments[0].content,
    ).toContain(comment.content);
    expect(screen.getByText('Preserved reply')).toBeTruthy();
    expect(
        screen
            .getByRole('button', { name: 'detail.comments.edit' })
            .hasAttribute('disabled'),
    ).toBe(true);
});

it.each([true, false])('keeps desired report=%s bound to the clicked comment, then shows the conflict and actually replaces stale content', async (desired) => {
    useAuthStore.setState({ sessionUser: { uid: 'reader', nickname: 'Reader' }, sessionVersion: 10 });
    const published = { ...comment, snapshotId: 'report-A', content: 'Report public A', flagged: !desired, author: { publicUid: 'owner', nickname: 'Owner' } };
    vi.mocked(client.listUGCComments).mockReset().mockResolvedValueOnce([published]);
    const refresh = vi.spyOn(client, 'getUGCCommentById').mockResolvedValue({ targetId: comment.id,
        path: [{ ...published, snapshotId: 'report-B', content: 'Report public B', flagged: false }], replies: [], repliesTruncated: false });
    const report = vi.spyOn(client, 'toggleUGCCommentFlag').mockRejectedValue(new client.UGCClientError('Changed', 'PUBLIC_SNAPSHOT_CONFLICT', 409));
    render(createElement(Comments, { point, pointName: 'Point', active: true }));
    fireEvent.click(await screen.findByRole('button', { name: desired ? 'detail.viewer.flag' : 'detail.viewer.unflag' }));
    await screen.findByText('Report public B');
    expect(screen.queryByText('Report public A')).toBeNull();
    expect(screen.getByText('detail.errors.reportVersionChanged')).toBeTruthy();
    expect(report).toHaveBeenCalledExactlyOnceWith(comment.id, desired, 'report-A');
    expect(refresh).toHaveBeenCalledExactlyOnceWith(point.id, comment.id);
});

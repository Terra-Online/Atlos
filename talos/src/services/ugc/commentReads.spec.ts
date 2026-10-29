import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/data/marker', () => ({ MARKER_TYPE_DICT: {} }));
vi.mock('@/services/routing/share', () => ({ buildPointShareToken: vi.fn() }));
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
    vi.resetModules();
    fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());
const comment = {
    id: 'root',
    snapshotId: 'B',
    markerId: 'm',
    parentId: null,
    depth: 0,
    content: 'Private B',
    status: 'pending_audit',
    createdAt: '',
    score: 0,
    replyCount: 0,
    replies: [],
};

it('keeps comment bodies and snapshot identities together across cache hits and account changes', async () => {
    const { useAuthStore } = await import('@/store/auth');
    const { listUGCComments, peekUGCComments } = await import('./client');
    useAuthStore.getState().setSessionUser({ uid: 'owner', nickname: 'Owner' });
    fetcher.mockResolvedValueOnce(Response.json({ items: [comment] }));
    expect(await listUGCComments('m')).toMatchObject([
        { snapshotId: 'B', content: 'Private B' },
    ]);
    expect(peekUGCComments('m')).toMatchObject([{ snapshotId: 'B' }]);
    useAuthStore.getState().clearSessionUser();
    expect(peekUGCComments('m')).toBeNull();
    fetcher.mockResolvedValueOnce(
        Response.json({
            items: [
                {
                    ...comment,
                    snapshotId: 'A',
                    content: 'Public A',
                    status: 'active',
                },
            ],
        }),
    );
    expect(await listUGCComments('m')).toMatchObject([
        { snapshotId: 'A', content: 'Public A' },
    ]);
});

it('does not attach a public translation to the owner pending body', async () => {
    const { requestCommentTranslations } = await import(
        '@/component/detail/comment/translationCoordinator'
    );
    fetcher.mockImplementation(() =>
        Promise.resolve(
            Response.json({
                items: [
                    {
                        commentId: 'root',
                        snapshotId: 'A',
                        translatedContent: 'Translation of A',
                        targetLanguage: 'en-US',
                        cached: true,
                    },
                ],
            }),
        ),
    );
    expect(
        await requestCommentTranslations(
            [{ ...comment, snapshotId: 'A', content: 'Public A' }],
            'en-US',
            { allowLive: false, liveAttemptPolicy: 'once' },
        ),
    ).toMatchObject([
        { snapshotId: 'A', translatedContent: 'Translation of A' },
    ]);
    expect(
        await requestCommentTranslations([comment], 'en-US', {
            allowLive: false,
            liveAttemptPolicy: 'once',
        }),
    ).toEqual([]);
});

it('retains public image snapshot identity when normalizing the development asset URL', async () => {
    const { listPublicUGCImages } = await import('./client');
    fetcher.mockResolvedValueOnce(
        Response.json({
            items: [
                {
                    id: 'image',
                    snapshotId: 'image-A',
                    markerId: 'm',
                    url: 'https://assets.example/prod/image.webp',
                    content: null,
                    createdAt: '',
                },
            ],
        }),
    );
    expect(await listPublicUGCImages('m')).toMatchObject([
        { id: 'image', snapshotId: 'image-A' },
    ]);
});

it('rejects a private response arriving after sign-out instead of repopulating the anonymous cache', async () => {
    const { useAuthStore } = await import('@/store/auth');
    const { listUGCComments, peekUGCComments } = await import('./client');
    useAuthStore.getState().setSessionUser({ uid: 'owner', nickname: 'Owner' });
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(
        () =>
            new Promise<Response>((resolve) => {
                finish = resolve;
            }),
    );
    const oldRead = listUGCComments('m');
    const rejected = expect(oldRead).rejects.toMatchObject({
        code: 'SESSION_CHANGED',
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    useAuthStore.getState().clearSessionUser();
    fetcher.mockResolvedValueOnce(
        Response.json({
            items: [
                {
                    ...comment,
                    snapshotId: 'A',
                    content: 'Public A',
                    status: 'active',
                },
            ],
        }),
    );
    await listUGCComments('m');
    finish(Response.json({ items: [comment] }));
    await rejected;
    expect(peekUGCComments('m')).toMatchObject([
        { snapshotId: 'A', content: 'Public A' },
    ]);
});

it('discards an owner deep-link context returned after sign-out', async () => {
    const { useAuthStore } = await import('@/store/auth');
    const { getUGCCommentById } = await import('./client');
    useAuthStore.getState().setSessionUser({ uid: 'owner', nickname: 'Owner' });
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(
        () =>
            new Promise<Response>((resolve) => {
                finish = resolve;
            }),
    );
    const read = getUGCCommentById('m', 'root');
    const rejected = expect(read).rejects.toMatchObject({
        code: 'SESSION_CHANGED',
    });
    useAuthStore.getState().clearSessionUser();
    finish(
        Response.json({
            item: {
                targetId: 'root',
                path: [comment],
                replies: [],
                repliesTruncated: false,
            },
        }),
    );
    await rejected;
});

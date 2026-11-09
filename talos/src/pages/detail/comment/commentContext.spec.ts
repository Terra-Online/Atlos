import { describe, expect, it } from 'vitest';
import { mergeCommentContext } from '@/pages/detail/comment/commentContext';
import type { UGCComment } from '@/services/ugc/client';

const comment = (id: string, parentId: string | null = null): UGCComment => ({ type: 'comment',
    id, parentId, markerId: '1', depth: 0, content: id, createdAt: '',
    score: 0, status: 'active', replyCount: 0, replies: [],
});

describe('mergeCommentContext', () => {
    it('adds missing ancestors and replies without overwriting local state or duplicating nodes', () => {
        const local = { ...comment('target', 'root'), viewerVote: 1 as const, translatedContent: 'local' };
        const result = mergeCommentContext([local], {
            targetId: 'target', path: [comment('root'), comment('target', 'root')],
            replies: [comment('reply', 'target')], repliesTruncated: true,
        });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('root');
        expect(result[0].replies[0]).toMatchObject({ viewerVote: 1, translatedContent: 'local' });
        expect(result[0].replies[0].replies.map(item => item.id)).toEqual(['reply']);
        expect(local.replies).toEqual([]);
    });

    it('keeps comments with unavailable ancestors visible', () => {
        const result = mergeCommentContext([], {
            targetId: 'target', path: [comment('target', 'hidden')], replies: [], repliesTruncated: false,
        });
        expect(result.map(item => item.id)).toEqual(['target']);
    });
});

it('refreshes a changed version as one body/identity pair and drops the old translation', () => {
    const local = {
        ...comment('target'),
        snapshotId: 'A',
        content: 'Published A',
        replyCount: 2,
        score: 10,
        viewerVote: 1 as const,
        translatedContent: 'Translation of A',
    };
    const result = mergeCommentContext([local], {
        targetId: 'target',
        path: [
            { ...comment('target'), snapshotId: 'C', content: 'Published C' },
        ],
        replies: [],
        repliesTruncated: false,
    });
    expect(result[0]).toMatchObject({
        snapshotId: 'C',
        content: 'Published C',
        replyCount: 2,
        score: 10,
        viewerVote: 1,
    });
    expect('translatedContent' in result[0] ? result[0].translatedContent : undefined).toBeUndefined();
});
it('keeps an author pending overlay when merging public context for the same content ID', () => {
    const local = {
        ...comment('target'),
        snapshotId: 'B',
        content: 'Private B',
        status: 'pending_audit' as const,
    };
    const result = mergeCommentContext([local], {
        targetId: 'target',
        path: [
            { ...comment('target'), snapshotId: 'A', content: 'Published A' },
        ],
        replies: [comment('reply', 'target')],
        repliesTruncated: false,
    });
    expect(result[0]).toMatchObject({
        snapshotId: 'B',
        content: 'Private B',
        replies: [{ id: 'reply' }],
    });
});

it('replaces cached private content with a placeholder without carrying its metadata or translation', () => {
    const privateComment = { ...comment('hidden'), translatedContent: 'Private translation', content: 'Private body', author: { publicUid: 'secret', nickname: 'Private author' } };
    const placeholder = { type: 'placeholder' as const, id: 'hidden', markerId: '1', parentId: null, depth: 0, replyCount: 1, replies: [] };
    const result = mergeCommentContext([privateComment], { targetId: 'hidden', path: [placeholder], replies: [comment('child', 'hidden')], repliesTruncated: false });
    expect(result).toEqual([{ ...placeholder, replies: [comment('child', 'hidden')] }]);
});

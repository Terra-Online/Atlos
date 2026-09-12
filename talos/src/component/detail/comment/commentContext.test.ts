import { describe, expect, it } from 'vitest';
import { mergeCommentContext } from './commentContext';
import type { UGCComment } from '@/utils/ugcClient';

const comment = (id: string, parentId: string | null = null): UGCComment => ({
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

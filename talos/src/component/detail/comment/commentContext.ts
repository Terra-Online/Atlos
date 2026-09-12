import type { UGCComment, UGCCommentContext } from '@/utils/ugcClient';
import { flatList } from './commentsTree';

export function mergeCommentContext(comments: UGCComment[], context: UGCCommentContext): UGCComment[] {
    // Existing nodes win so a public response cannot reset local votes or translations.
    const nodes = new Map<string, UGCComment>();
    for (const comment of [...flatList(comments), ...context.path, ...context.replies]) {
        if (!nodes.has(comment.id)) nodes.set(comment.id, { ...comment, replies: [] });
    }
    const roots: UGCComment[] = [];
    for (const comment of nodes.values()) {
        const parent = comment.parentId ? nodes.get(comment.parentId) : undefined;
        if (parent) parent.replies.push(comment);
        else roots.push(comment);
    }
    return roots;
}

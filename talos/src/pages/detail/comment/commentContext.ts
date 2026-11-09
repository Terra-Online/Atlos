import type { UGCCommentNode, UGCCommentContext } from '@/services/ugc/client';
import { clearTrans, flatList, isReviewing } from '@/pages/detail/comment/commentsTree';

export function mergeCommentContext(comments: UGCCommentNode[], context: UGCCommentContext): UGCCommentNode[] {
    // Submission ID owns tree identity. A changed version replaces body and ID
    // together; local reactions survive and old translations cannot follow it.
    const nodes = new Map<string, UGCCommentNode>();
    for (const comment of [
        ...flatList(comments),
        ...context.path,
        ...context.replies,
    ]) {
        const existing = nodes.get(comment.id);
        if (!existing) {
            nodes.set(comment.id, { ...comment, replies: [] });
        } else if (comment.type === 'placeholder') {
            // A fresh hidden node must discard every cached content field.
            nodes.set(comment.id, { ...comment, replies: [] });
        } else if (existing.type === 'placeholder') {
            nodes.set(comment.id, { ...comment, replies: [] });
        } else if (
            existing.snapshotId !== comment.snapshotId &&
            !(isReviewing(existing.status) && !isReviewing(comment.status))
        ) {
            nodes.set(comment.id, {
                ...clearTrans(existing),
                snapshotId: comment.snapshotId,
                content: comment.content,
                status: comment.status,
                replies: [],
            });
        }
    }
    const roots: UGCCommentNode[] = [];
    for (const comment of nodes.values()) {
        const parent = comment.parentId
            ? nodes.get(comment.parentId)
            : undefined;
        if (parent) parent.replies.push(comment);
        else roots.push(comment);
    }
    return roots;
}

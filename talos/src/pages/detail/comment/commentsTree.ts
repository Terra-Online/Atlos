import type { IMarkerData } from '@/data/marker';
import type {
    UGCComment,
    UGCCommentActionPatch,
    UGCCommentSubmission,
    UGCCommentVoteValue,
    UGCSubmissionStatus,
} from '@/services/ugc/client';
import type { SessionUser } from '@/services/auth';

const MAX_DEPTH = 2;
export const LOCAL_PENDING_COMMENT_PREFIX = 'local-comment:';

export type DisplayItem = {
    comment: UGCComment;
    displayDepth: number;
};

export const isVisible = (status: UGCSubmissionStatus | undefined): boolean => (
    status === 'active' || status === 'flagged' || status === 'remove_request'
);

export const isReviewing = (status: UGCSubmissionStatus | undefined): boolean => (
    status === 'pending_openai' || status === 'pending_audit'
);

export const collectIds = (comment: UGCComment): string[] => (
    [comment.id, ...comment.replies.flatMap(collectIds)]
);

export const flatList = (comments: UGCComment[]): UGCComment[] => (
    comments.flatMap((comment) => [comment, ...flatList(comment.replies)])
);

export const flatDisplay = (
    comments: UGCComment[],
    depth = 0,
): DisplayItem[] => (
    comments.flatMap((comment) => [
        {
            comment,
            displayDepth: Math.min(depth, MAX_DEPTH),
        },
        ...flatDisplay(comment.replies, depth + 1),
    ])
);

export const makePending = (
    point: IMarkerData,
    content: string,
    submission: UGCCommentSubmission,
    user: SessionUser | null,
): UGCComment => ({
    id: submission.id,
    markerId: submission.markerId,
    poiType: point.type,
    parentId: submission.parentId,
    depth: submission.depth,
    content,
    author: user
        ? {
            nickname: user.nickname,
            publicUid: user.uid,
            avatar: user.avatar,
        }
        : null,
    createdAt: new Date().toISOString(),
    score: 0,
    viewerVote: 0,
    flagged: false,
    recallRequested: false,
    status: submission.status,
    replyCount: 0,
    replies: [],
});

export const makeLocalPending = (
    point: IMarkerData,
    content: string,
    parent: UGCComment | null,
    localId: string,
    user: SessionUser | null,
): UGCComment => ({
    id: localId,
    markerId: point.id,
    poiType: point.type,
    parentId: parent?.id ?? null,
    depth: parent ? parent.depth + 1 : 0,
    content,
    author: user
        ? {
            nickname: user.nickname,
            publicUid: user.uid,
            avatar: user.avatar,
        }
        : null,
    createdAt: new Date().toISOString(),
    score: 0,
    viewerVote: 0,
    flagged: false,
    recallRequested: false,
    status: 'pending_audit',
    replyCount: 0,
    replies: [],
});

export const appendItem = (comments: UGCComment[], comment: UGCComment): UGCComment[] => {
    if (!comment.parentId) {
        return [comment, ...comments];
    }

    const appendTo = (items: UGCComment[]): [UGCComment[], boolean] => {
        let inserted = false;
        const nextItems = items.map((item) => {
            if (item.id === comment.parentId) {
                inserted = true;
                return {
                    ...item,
                    replyCount: item.replyCount + 1,
                    replies: [...item.replies, comment],
                };
            }

            if (item.replies.length === 0) return item;
            const [nextReplies, childInserted] = appendTo(item.replies);
            if (!childInserted) return item;
            inserted = true;
            return {
                ...item,
                replies: nextReplies,
            };
        });

        return inserted ? [nextItems, true] : [items, false];
    };

    const [nextComments, inserted] = appendTo(comments);
    return inserted ? nextComments : [comment, ...comments];
};

export const removeTree = (
    comments: UGCComment[],
    commentId: string,
): {
    comments: UGCComment[];
    removedIds: Set<string>;
} => {
    let removed: UGCComment | null = null;

    const removeFrom = (items: UGCComment[]): [UGCComment[], boolean, boolean] => {
        let changed = false;
        let removedChild = false;
        const nextItems: UGCComment[] = [];

        items.forEach((item) => {
            if (item.id === commentId) {
                removed = item;
                changed = true;
                removedChild = true;
                return;
            }

            if (item.replies.length === 0) {
                nextItems.push(item);
                return;
            }

            const [nextReplies, childChanged, childRemoved] = removeFrom(item.replies);
            if (!childChanged) {
                nextItems.push(item);
                return;
            }

            changed = true;
            nextItems.push({
                ...item,
                replyCount: childRemoved ? Math.max(0, item.replyCount - 1) : item.replyCount,
                replies: nextReplies,
            });
        });

        return changed ? [nextItems, true, removedChild] : [items, false, false];
    };

    const [nextComments] = removeFrom(comments);
    return {
        comments: nextComments,
        removedIds: new Set(removed ? collectIds(removed) : []),
    };
};

export const patchTree = (
    comments: UGCComment[],
    commentId: string,
    patch: (comment: UGCComment) => UGCComment,
): UGCComment[] => (
    comments.map((comment) => {
        if (comment.id === commentId) {
            return patch(comment);
        }

        if (comment.replies.length === 0) return comment;
        return { ...comment, replies: patchTree(comment.replies, commentId, patch) };
    })
);

export const clearTrans = (comment: UGCComment): UGCComment => ({
    ...comment,
    translatedContent: undefined,
    translationSourceLanguage: undefined,
    translationTargetLanguage: undefined,
    translationHidden: undefined,
    translationStatus: undefined,
    replies: comment.replies.map(clearTrans),
});

export const clearAllTrans = (comments: UGCComment[]): UGCComment[] => (
    comments.map(clearTrans)
);

export const applyPatch = (comment: UGCComment, patch: UGCCommentActionPatch): UGCComment => ({
    ...comment,
    ...patch,
    recallRequested: patch.recallRequested ?? comment.recallRequested,
    replies: comment.replies,
});

export const voteDelta = (current: UGCCommentVoteValue | undefined, next: UGCCommentVoteValue): number => (
    next - (current ?? 0)
);

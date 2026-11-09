import type { IMarkerData } from '@/data/marker';
import type {
    UGCComment,
    UGCCommentNode,
    UGCCommentActionPatch,
    UGCCommentSubmission,
    UGCCommentVoteValue,
    UGCSubmissionStatus,
} from '@/services/ugc/client';
import type { SessionUser } from '@/services/auth';

const MAX_DEPTH = 2;
export const LOCAL_PENDING_COMMENT_PREFIX = 'local-comment:';

export type DisplayItem = {
    comment: UGCCommentNode;
    displayDepth: number;
};

export const isVisible = (status: UGCSubmissionStatus | undefined): boolean => (
    status === 'active' || status === 'flagged'
);

export const isReviewing = (status: UGCSubmissionStatus | undefined): boolean => (
    status === 'pending_openai' || status === 'pending_audit'
);

export const collectIds = (comment: UGCCommentNode): string[] => (
    [comment.id, ...comment.replies.flatMap(collectIds)]
);

export const flatList = (comments: UGCCommentNode[]): UGCCommentNode[] => (
    comments.flatMap((comment) => [comment, ...flatList(comment.replies)])
);

export const flatDisplay = (
    comments: UGCCommentNode[],
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
    type: 'comment',
    id: submission.id,
    snapshotId: submission.snapshotId,
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
    type: 'comment',
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
    status: 'pending_audit',
    replyCount: 0,
    replies: [],
});

export const appendItem = (comments: UGCCommentNode[], comment: UGCComment): UGCCommentNode[] => {
    if (!comment.parentId) {
        return [comment, ...comments];
    }

    const appendTo = (items: UGCCommentNode[]): [UGCCommentNode[], boolean] => {
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

/** Hide only the selected body; retain replies and prune empty connectors. */
export const hideComment = (comments: UGCCommentNode[], id: string): UGCCommentNode[] => {
    let changed = false;
    const next = comments.flatMap((comment): UGCCommentNode[] => {
        const replies = hideComment(comment.replies, id);
        if (comment.id === id) {
            changed = true;
            return replies.length ? [{
                type: 'placeholder',
                id: comment.id,
                markerId: comment.markerId,
                parentId: comment.parentId,
                depth: comment.depth,
                replyCount: comment.replyCount,
                replies,
            }] : [];
        }
        if (replies === comment.replies) return [comment];
        changed = true;
        if (comment.type === 'placeholder' && replies.length === 0) return [];
        return [{ ...comment, replies, replyCount: Math.max(0, comment.replyCount - (comment.replies.length - replies.length)) }];
    });
    return changed ? next : comments;
};

export const patchTree = (
    comments: UGCCommentNode[],
    commentId: string,
    patch: (comment: UGCComment) => UGCComment,
): UGCCommentNode[] => (
    comments.map((comment) => {
        if (comment.id === commentId && comment.type === 'comment') {
            return patch(comment);
        }

        if (comment.replies.length === 0) return comment;
        return { ...comment, replies: patchTree(comment.replies, commentId, patch) };
    })
);

export function clearTrans(comment: UGCComment): UGCComment;
export function clearTrans(comment: UGCCommentNode): UGCCommentNode;
export function clearTrans(comment: UGCCommentNode): UGCCommentNode {
    const replies = comment.replies.map(clearTrans);
    if (comment.type === 'placeholder') return { ...comment, replies };
    return {
        ...comment,
        translatedContent: undefined,
        translationSourceLanguage: undefined,
        translationTargetLanguage: undefined,
        translationHidden: undefined,
        translationStatus: undefined,
        replies,
    };
};

export const clearAllTrans = (comments: UGCCommentNode[]): UGCCommentNode[] => (
    comments.map(clearTrans)
);

export const applyPatch = (comment: UGCComment, patch: UGCCommentActionPatch): UGCComment => ({
    ...comment,
    ...patch,
    replies: comment.replies,
});

export const voteDelta = (current: UGCCommentVoteValue | undefined, next: UGCCommentVoteValue): number => (
    next - (current ?? 0)
);

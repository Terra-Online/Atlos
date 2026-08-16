import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
    invalidateUGCCommentCache,
    recallUGCComment,
    type UGCComment,
} from '@/services/ugc/client';
import { collectIds, patchTree, removeTree } from './commentsTree';
import { removeCommentSubmission, restoreCommentSubmission } from './commentSubmissionStore';

type Args = {
    markerId: string;
    comments: UGCComment[];
    busyIds: Set<string>;
    replyTarget: UGCComment | null;
    requireAuth: () => boolean;
    setBusy: (commentId: string, pending: boolean) => void;
    setComments: Dispatch<SetStateAction<UGCComment[]>>;
    setReply: Dispatch<SetStateAction<UGCComment | null>>;
    clearSync: (commentIds: Set<string>) => void;
};

export const useRecall = ({
    markerId,
    comments,
    busyIds,
    replyTarget,
    requireAuth,
    setBusy,
    setComments,
    setReply,
    clearSync,
}: Args) => (
    useCallback((comment: UGCComment) => {
        if (!requireAuth() || busyIds.has(comment.id)) return;
        if (comment.editUndoAvailable) {
            const removedSubmission = removeCommentSubmission(markerId, comment.id);
            setBusy(comment.id, true);
            void recallUGCComment(comment.id)
                .then((patch) => {
                    if (!patch.editReverted || patch.content === undefined) {
                        const removedIds = new Set(collectIds(comment));
                        setComments((current) => removeTree(current, comment.id).comments);
                        setReply((current) => (current && removedIds.has(current.id) ? null : current));
                        clearSync(removedIds);
                        invalidateUGCCommentCache(markerId);
                        return;
                    }
                    const revertedComment: UGCComment = {
                        ...comment,
                        content: patch.content,
                        status: patch.status,
                        editUndoAvailable: false,
                        translatedContent: undefined,
                        translationSourceLanguage: undefined,
                        translationTargetLanguage: undefined,
                        translationHidden: undefined,
                        translationStatus: undefined,
                    };
                    setComments((current) => patchTree(current, comment.id, () => revertedComment));
                    if (removedSubmission) {
                        restoreCommentSubmission(markerId, revertedComment);
                    }
                    invalidateUGCCommentCache(markerId);
                })
                .catch(() => {
                    if (removedSubmission) restoreCommentSubmission(markerId, removedSubmission);
                })
                .finally(() => setBusy(comment.id, false));
            return;
        }
        const previousComments = comments;
        const previousReplyTarget = replyTarget;
        const displayRemovedIds = new Set(collectIds(comment));
        const removedSubmissions = [...displayRemovedIds]
            .map((commentId) => removeCommentSubmission(markerId, commentId))
            .filter((item): item is UGCComment => Boolean(item));
        const removal = removeTree(comments, comment.id);
        const removedIds = new Set([
            ...removal.removedIds,
            ...displayRemovedIds,
        ]);

        setComments(removal.comments);
        setReply((current) => (current && removedIds.has(current.id) ? null : current));
        invalidateUGCCommentCache(markerId);
        clearSync(removedIds);
        setBusy(comment.id, true);
        void recallUGCComment(comment.id)
            .then(() => undefined)
            .catch(() => {
                removedSubmissions.forEach((submission) => restoreCommentSubmission(markerId, submission));
                setComments(previousComments);
                setReply(previousReplyTarget);
            })
            .finally(() => setBusy(comment.id, false));
    }, [
        busyIds,
        clearSync,
        comments,
        markerId,
        replyTarget,
        requireAuth,
        setBusy,
        setComments,
        setReply,
    ])
);

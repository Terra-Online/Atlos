import { useAuthStore } from '@/store/auth';
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
    invalidateUGCCommentCache,
    deleteUGCComment,
    type UGCComment,
} from '@/services/ugc/client';
import { collectIds, removeTree } from './commentsTree';
import {
    removeCommentSubmission,
    restoreCommentSubmission,
} from './commentSubmissionStore';

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

export const useDeleteComment = ({
    markerId,
    comments,
    busyIds,
    replyTarget,
    requireAuth,
    setBusy,
    setComments,
    setReply,
    clearSync,
}: Args) =>
    useCallback(
        (comment: UGCComment) => {
            if (!requireAuth() || busyIds.has(comment.id)) return;
            const accountVersion = useAuthStore.getState().sessionVersion;
            const previousComments = comments;
            const previousReplyTarget = replyTarget;
            const displayRemovedIds = new Set(collectIds(comment));
            const removedSubmissions = [...displayRemovedIds]
                .map((commentId) =>
                    removeCommentSubmission(markerId, commentId),
                )
                .filter((item): item is UGCComment => Boolean(item));
            const removal = removeTree(comments, comment.id);
            const removedIds = new Set([
                ...removal.removedIds,
                ...displayRemovedIds,
            ]);

            setComments(removal.comments);
            setReply((current) =>
                current && removedIds.has(current.id) ? null : current,
            );
            invalidateUGCCommentCache(markerId);
            clearSync(removedIds);
            setBusy(comment.id, true);
            void deleteUGCComment(comment.id)
                .then(() => invalidateUGCCommentCache(markerId))
                .catch(() => {
                    if (
                        useAuthStore.getState().sessionVersion !==
                        accountVersion
                    )
                        return;
                    removedSubmissions.forEach((submission) =>
                        restoreCommentSubmission(markerId, submission),
                    );
                    setComments(previousComments);
                    setReply(previousReplyTarget);
                })
                .finally(() => setBusy(comment.id, false));
        },
        [
            busyIds,
            clearSync,
            comments,
            markerId,
            replyTarget,
            requireAuth,
            setBusy,
            setComments,
            setReply,
        ],
    );

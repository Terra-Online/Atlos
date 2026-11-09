import { useAuthStore } from '@/store/auth';
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
    invalidateUGCCommentCache,
    deleteUGCComment,
    type UGCComment,
    type UGCCommentNode,
} from '@/services/ugc/client';
import { hideComment } from './commentsTree';
import {
    removeCommentSubmission,
    restoreCommentSubmission,
} from './commentSubmissionStore';

type Args = {
    markerId: string;
    comments: UGCCommentNode[];
    busyIds: Set<string>;
    replyTarget: UGCComment | null;
    requireAuth: () => boolean;
    setBusy: (commentId: string, pending: boolean) => void;
    setComments: Dispatch<SetStateAction<UGCCommentNode[]>>;
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
            const removedSubmission = removeCommentSubmission(markerId, comment.id);
            setComments(hideComment(comments, comment.id));
            setReply((current) => current?.id === comment.id ? null : current);
            invalidateUGCCommentCache(markerId);
            clearSync(new Set([comment.id]));
            setBusy(comment.id, true);
            void deleteUGCComment(comment.id)
                .then(() => invalidateUGCCommentCache(markerId))
                .catch(() => {
                    if (
                        useAuthStore.getState().sessionVersion !==
                        accountVersion
                    )
                        return;
                    if (removedSubmission) restoreCommentSubmission(markerId, removedSubmission);
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

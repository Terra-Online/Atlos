import { useCallback, useEffect, useRef } from 'react';
import type { UGCComment, UGCCommentActionPatch, UGCCommentVoteValue } from '@/services/ugc/client';
import { toggleUGCCommentFlag, voteUGCComment } from '@/services/ugc/client';
import { applyPatch, voteDelta } from './commentsTree';

type Task<T> = {
    desired: T;
    inFlight: boolean;
    lastSynced: T;
    timer?: number;
};

type Config<T> = {
    delay: number;
    patch: (commentId: string, patch: (comment: UGCComment) => UGCComment) => void;
    send: (commentId: string, desired: T, lastSynced: T) => Promise<UGCCommentActionPatch | null>;
    rollback: (comment: UGCComment, lastSynced: T) => UGCComment;
};

const getTask = <T,>(
    tasks: Map<string, Task<T>>,
    commentId: string,
    currentValue: T,
): Task<T> => {
    const current = tasks.get(commentId);
    if (current) return current;
    const task = {
        desired: currentValue,
        inFlight: false,
        lastSynced: currentValue,
    };
    tasks.set(commentId, task);
    return task;
};

const useSync = <T,>({
    delay,
    patch,
    send,
    rollback,
}: Config<T>) => {
    const tasksRef = useRef(new Map<string, Task<T>>());

    const schedule = useCallback((commentId: string) => {
        const task = tasksRef.current.get(commentId);
        if (!task) return;
        if (task.timer) {
            window.clearTimeout(task.timer);
        }

        task.timer = window.setTimeout(() => {
            task.timer = undefined;
            if (task.inFlight) return;
            if (task.desired === task.lastSynced) return;

            const sentState = task.desired;
            task.inFlight = true;
            void send(commentId, sentState, task.lastSynced)
                .then((actionPatch) => {
                    task.lastSynced = sentState;
                    if (task.desired === sentState && actionPatch) {
                        patch(commentId, (item) => applyPatch(item, actionPatch));
                    }
                })
                .catch(() => {
                    if (task.desired !== sentState) return;
                    task.desired = task.lastSynced;
                    patch(commentId, (item) => rollback(item, task.lastSynced));
                })
                .finally(() => {
                    task.inFlight = false;
                    if (task.desired !== task.lastSynced) {
                        schedule(commentId);
                    }
                });
        }, delay);
    }, [delay, patch, rollback, send]);

    const start = useCallback((commentId: string, currentValue: T, desired: T) => {
        const task = getTask(tasksRef.current, commentId, currentValue);
        task.desired = desired;
        schedule(commentId);
    }, [schedule]);

    const clear = useCallback((commentIds: Set<string>) => {
        commentIds.forEach((commentId) => {
            const task = tasksRef.current.get(commentId);
            if (task?.timer) window.clearTimeout(task.timer);
            tasksRef.current.delete(commentId);
        });
    }, []);

    useEffect(() => () => {
        tasksRef.current.forEach((task) => {
            if (task.timer) window.clearTimeout(task.timer);
        });
    }, []);

    return { start, clear };
};

const voteReq = (
    lastSynced: UGCCommentVoteValue,
    desired: UGCCommentVoteValue,
): 1 | -1 | null => {
    if (desired === 1 || desired === -1) return desired;
    if (lastSynced === 1 || lastSynced === -1) return lastSynced;
    return null;
};

export const useVoteSync = (
    delay: number,
    patch: (commentId: string, patch: (comment: UGCComment) => UGCComment) => void,
) => {
    const send = useCallback(async (
        commentId: string,
        desired: UGCCommentVoteValue,
        lastSynced: UGCCommentVoteValue,
    ) => {
        const value = voteReq(lastSynced, desired);
        if (value === null) return null;
        return voteUGCComment(commentId, value);
    }, []);

    const rollback = useCallback((comment: UGCComment, lastSynced: UGCCommentVoteValue): UGCComment => {
        const currentVote = comment.viewerVote ?? 0;
        if (currentVote === lastSynced) return comment;
        return {
            ...comment,
            viewerVote: lastSynced,
            score: comment.score + voteDelta(currentVote, lastSynced),
        };
    }, []);

    return useSync({
        delay,
        patch,
        send,
        rollback,
    });
};

export const useFlagSync = (
    delay: number,
    patch: (commentId: string, patch: (comment: UGCComment) => UGCComment) => void,
) => {
    const send = useCallback((commentId: string, desired: boolean) => (
        toggleUGCCommentFlag(commentId, desired)
    ), []);

    const rollback = useCallback((comment: UGCComment, lastSynced: boolean): UGCComment => ({
        ...comment,
        flagged: lastSynced,
        status: lastSynced ? 'flagged' : comment.status === 'flagged' ? 'active' : comment.status,
    }), []);

    return useSync({
        delay,
        patch,
        send,
        rollback,
    });
};

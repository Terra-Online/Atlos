import type { IMarkerData } from '@/data/marker';
import type { SessionUser } from '@/services/auth';
import {
    invalidateUGCCommentCache,
    submitUGCComment,
    UGCClientError,
    type UGCComment,
} from '@/services/ugc/client';
import {
    LOCAL_PENDING_COMMENT_PREFIX,
    appendItem,
    collectIds,
    makeLocalPending,
    makePending,
} from './commentsTree';

type CommentSubmissionTaskStatus = 'submitting' | 'submitted';

type CommentSubmissionTask = {
    localId: string;
    markerId: string;
    status: CommentSubmissionTaskStatus;
    comment: UGCComment;
};

export type CommentSubmissionError = {
    id: number;
    markerId: string;
    code?: string;
};

export type CommentSubmissionSnapshot = {
    markerId: string;
    comments: UGCComment[];
    submittingIds: string[];
    lastError: CommentSubmissionError | null;
};

const emptySubmissionSnapshot: CommentSubmissionSnapshot = {
    markerId: '',
    comments: [],
    submittingIds: [],
    lastError: null,
};

const submissionTasks = new Map<string, CommentSubmissionTask[]>();
const submissionSnapshots = new Map<string, CommentSubmissionSnapshot>();
const submissionErrors = new Map<string, CommentSubmissionError>();
const submissionListeners = new Set<() => void>();
let nextLocalCommentId = 1;
let nextSubmissionErrorId = 1;

export const subscribeCommentSubmissions = (listener: () => void): (() => void) => {
    submissionListeners.add(listener);
    return () => submissionListeners.delete(listener);
};

export const getCommentSubmissionSnapshot = (markerId: string): CommentSubmissionSnapshot => {
    if (!markerId) return emptySubmissionSnapshot;

    let snapshot = submissionSnapshots.get(markerId);
    if (!snapshot) {
        snapshot = buildSnapshot(markerId);
        submissionSnapshots.set(markerId, snapshot);
    }
    return snapshot;
};

export const mergeCommentSubmissions = (
    comments: UGCComment[],
    snapshot: CommentSubmissionSnapshot,
): UGCComment[] => (
    snapshot.comments.reduce((current, comment) => (
        hasComment(current, comment.id) ? current : appendItem(current, comment)
    ), comments)
);

export const syncCommentSubmissions = (markerId: string, serverComments: UGCComment[]): void => {
    const tasks = submissionTasks.get(markerId);
    if (!tasks?.length) return;

    const serverIds = new Set(serverComments.flatMap(collectIds));
    const nextTasks = tasks.filter((task) => (
        task.status !== 'submitted' || !serverIds.has(task.comment.id)
    ));

    if (nextTasks.length === tasks.length) return;

    if (nextTasks.length > 0) {
        submissionTasks.set(markerId, nextTasks);
    } else {
        submissionTasks.delete(markerId);
    }
    emitSubmissionSnapshot(markerId);
};

export const removeCommentSubmission = (markerId: string, commentId: string): UGCComment | null => {
    const tasks = submissionTasks.get(markerId);
    if (!tasks?.length) return null;

    const task = tasks.find((item) => item.comment.id === commentId);
    if (!task) return null;

    const nextTasks = tasks.filter((item) => item !== task);
    if (nextTasks.length > 0) {
        submissionTasks.set(markerId, nextTasks);
    } else {
        submissionTasks.delete(markerId);
    }
    emitSubmissionSnapshot(markerId);
    return task.comment;
};

export const restoreCommentSubmission = (markerId: string, comment: UGCComment): void => {
    const tasks = submissionTasks.get(markerId) ?? [];
    if (tasks.some((task) => task.comment.id === comment.id)) return;

    submissionTasks.set(markerId, [
        ...tasks,
        {
            localId: comment.id,
            markerId,
            status: 'submitted',
            comment,
        },
    ]);
    emitSubmissionSnapshot(markerId);
};

export const submitCommentOptimistic = (
    point: IMarkerData,
    content: string,
    parent: UGCComment | null,
    user: SessionUser | null,
): string => {
    const markerId = point.id;
    const localId = `${LOCAL_PENDING_COMMENT_PREFIX}${Date.now().toString(36)}-${nextLocalCommentId++}`;
    const task: CommentSubmissionTask = {
        localId,
        markerId,
        status: 'submitting',
        comment: makeLocalPending(point, content, parent, localId, user),
    };

    const tasks = submissionTasks.get(markerId) ?? [];
    submissionTasks.set(markerId, [...tasks, task]);
    invalidateUGCCommentCache(markerId);
    emitSubmissionSnapshot(markerId);

    void submitUGCComment(point, content, parent?.id ?? null)
        .then((submission) => {
            updateSubmissionTask(markerId, localId, (current) => ({
                ...current,
                status: 'submitted',
                comment: {
                    ...makePending(point, content, submission, user),
                    createdAt: current.comment.createdAt,
                },
            }));
        })
        .catch((error: unknown) => {
            removeSubmissionTask(markerId, localId);
            submissionErrors.set(markerId, {
                id: nextSubmissionErrorId++,
                markerId,
                code: error instanceof UGCClientError ? error.code : undefined,
            });
            emitSubmissionSnapshot(markerId);
        });

    return localId;
};

const buildSnapshot = (markerId: string): CommentSubmissionSnapshot => {
    const tasks = submissionTasks.get(markerId) ?? [];
    return {
        markerId,
        comments: tasks.map((task) => task.comment),
        submittingIds: tasks
            .filter((task) => task.status === 'submitting')
            .map((task) => task.comment.id),
        lastError: submissionErrors.get(markerId) ?? null,
    };
};

const emitSubmissionSnapshot = (markerId: string): void => {
    submissionSnapshots.set(markerId, buildSnapshot(markerId));
    submissionListeners.forEach((listener) => listener());
};

const updateSubmissionTask = (
    markerId: string,
    localId: string,
    updater: (task: CommentSubmissionTask) => CommentSubmissionTask,
): void => {
    const tasks = submissionTasks.get(markerId);
    if (!tasks?.length) return;

    let changed = false;
    const nextTasks = tasks.map((task) => {
        if (task.localId !== localId) return task;
        changed = true;
        return updater(task);
    });

    if (!changed) return;
    submissionTasks.set(markerId, nextTasks);
    emitSubmissionSnapshot(markerId);
};

const removeSubmissionTask = (markerId: string, localId: string): void => {
    const tasks = submissionTasks.get(markerId);
    if (!tasks?.length) return;

    const nextTasks = tasks.filter((task) => task.localId !== localId);
    if (nextTasks.length === tasks.length) return;

    if (nextTasks.length > 0) {
        submissionTasks.set(markerId, nextTasks);
    } else {
        submissionTasks.delete(markerId);
    }
};

const hasComment = (comments: UGCComment[], commentId: string): boolean => (
    comments.some((comment) => (
        comment.id === commentId || hasComment(comment.replies, commentId)
    ))
);

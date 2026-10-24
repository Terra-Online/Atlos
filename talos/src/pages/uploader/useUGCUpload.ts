import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuthStore } from '@/store/auth';
import { useTranslateUI } from '@/locale';
import { openOemAuthModal } from '@/component/shared/account/authEvents';
import type { IMarkerData } from '@/data/marker';
import {
    listUGCPointImages,
    uploadUGCImage,
    UGCClientError,
    type UGCUploadSubmission,
    type UGCUploadTarget,
} from '@/services/ugc/client';
import type { PointImagesState } from '@/pages/uploader/useUGCPointImages';

export type UploadState = {
    uploading: boolean;
    uploadSent: boolean;
    progress: number;
    error: string | null;
    lastSubmission: UGCUploadSubmission | null;
    setLastSubmission: React.Dispatch<React.SetStateAction<UGCUploadSubmission | null>>;
    inputRef: React.RefObject<HTMLInputElement | null>;
    canUpload: boolean;
    canAppendUpload: boolean;
    requestUpload: () => void;
    requestAppendUpload: () => void;
    upload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
    uploadFile: (file: File) => Promise<void>;
};

type UploadTaskState = {
    markerId: string;
    taskId: number | null;
    uploading: boolean;
    uploadSent: boolean;
    progress: number;
    error: string | null;
    lastSubmission: UGCUploadSubmission | null;
    ownerUid: string | null;
    refreshedSubmissionKey: string | null;
    updatedAt: number;
};

const idleUploadTask: UploadTaskState = {
    markerId: '',
    taskId: null,
    uploading: false,
    uploadSent: false,
    progress: 0,
    error: null,
    lastSubmission: null,
    ownerUid: null,
    refreshedSubmissionKey: null,
    updatedAt: 0,
};

const uploadTasks = new Map<string, UploadTaskState>();
const uploadTaskListeners = new Set<() => void>();
const readers = new Map<string, number>();
let nextUploadTaskId = 1;

const pruneTasks = () => {
    for (const [id, task] of uploadTasks) {
        if (task.uploading || readers.has(id)) continue;
        if (Date.now() - task.updatedAt > 15 * 60_000 || uploadTasks.size > 128) uploadTasks.delete(id);
    }
};

const getUploadTask = (markerId: string): UploadTaskState => (
    uploadTasks.get(markerId) ?? idleUploadTask
);

const setUploadTask = (
    markerId: string,
    updater: (current: UploadTaskState) => UploadTaskState,
): void => {
    const current = uploadTasks.get(markerId) ?? { ...idleUploadTask, markerId };
    const next = updater(current);
    if (next === current) return;
    uploadTasks.delete(markerId);
    uploadTasks.set(markerId, { ...next, updatedAt: Date.now() });
    pruneTasks();
    uploadTaskListeners.forEach((listener) => listener());
};

const subscribeUploadTasks = (markerId: string, listener: () => void): (() => void) => {
    readers.set(markerId, (readers.get(markerId) ?? 0) + 1);
    uploadTaskListeners.add(listener);
    return () => {
        uploadTaskListeners.delete(listener);
        const count = (readers.get(markerId) ?? 1) - 1;
        if (count) readers.set(markerId, count);
        else readers.delete(markerId);
        pruneTasks();
    };
};

const useUGCUpload = (point: IMarkerData, imageState: PointImagesState): UploadState => {
    const tUI = useTranslateUI();
    const user = useAuthStore((state) => state.sessionUser);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const inputTargetRef = useRef<UGCUploadTarget | null>(null);
    const [pendingLoginUpload, setPendingLoginUpload] = useState(false);
    const uploadTask = useSyncExternalStore(
        useCallback((listener: () => void) => subscribeUploadTasks(point.id, listener), [point.id]),
        () => getUploadTask(point.id),
        () => idleUploadTask,
    );

    const { target, loading, setImages, setMyImages, pendingOwn, active } = imageState;
    const taskOwnedByUser = Boolean(user?.uid && uploadTask.ownerUid === user.uid);
    const visibleTask = taskOwnedByUser ? uploadTask : idleUploadTask;
    const { uploading, uploadSent, progress, error } = visibleTask;
    const lastSubmission = visibleTask.lastSubmission;
    const attemptedRefreshKeyRef = useRef<string | null>(null);
    const state = pendingOwn || uploadSent || lastSubmission?.status === 'pending_openai' || lastSubmission?.status === 'pending_audit'
        ? 'pending'
        : active
            ? 'hasImage'
            : 'noImage';
    const canUpload = Boolean(target) && !loading && state !== 'hasImage' && state !== 'pending' && !uploading;
    const canAppendUpload = Boolean(target) && !loading && !uploading;

    const errText = useCallback((err: unknown): string => {
        if (err instanceof UGCClientError) {
            const translated = tUI(`detail.errors.${err.code}`);
            const fallback = tUI(err.status ? 'detail.errors.backendUnknown' : 'detail.errors.uploadFailed');
            return typeof translated === 'string' && translated
                ? translated
                : fallback;
        }

        return tUI('detail.errors.uploadFailed');
    }, [tUI]);

    useEffect(() => {
        if (!pendingLoginUpload || !user) return undefined;
        const frame = requestAnimationFrame(() => {
            setPendingLoginUpload(false);
            inputRef.current?.click();
        });
        return () => cancelAnimationFrame(frame);
    }, [pendingLoginUpload, user]);

    useEffect(() => {
        if (!lastSubmission || !user) return;
        if (lastSubmission.markerId !== point.id) return;
        const refreshKey = `${user.uid}:${lastSubmission.id}`;
        if (uploadTask.refreshedSubmissionKey === refreshKey || attemptedRefreshKeyRef.current === refreshKey) return;
        attemptedRefreshKeyRef.current = refreshKey;

        let disposed = false;
        void listUGCPointImages(point.id, user.uid).then((result) => {
            if (disposed) return;
            if (result.images !== undefined && result.myImages !== undefined) {
                setUploadTask(point.id, (current) => (
                    current.ownerUid === user.uid
                        && current.lastSubmission?.id === lastSubmission.id
                        ? { ...current, refreshedSubmissionKey: refreshKey }
                        : current
                ));
            }
            if (result.images) setImages(result.images);
            if (result.myImages) setMyImages(result.myImages);
        }).catch(() => {
            if (disposed) return;
            setUploadTask(point.id, (current) => (
                current.ownerUid === user.uid
                    && current.lastSubmission?.id === lastSubmission.id
                    && current.refreshedSubmissionKey === refreshKey
                    ? { ...current, refreshedSubmissionKey: null }
                    : current
            ));
        });
        return () => { disposed = true; };
    }, [lastSubmission, point.id, setImages, setMyImages, uploadTask.refreshedSubmissionKey, user]);

    const setLastSubmission = useCallback<React.Dispatch<React.SetStateAction<UGCUploadSubmission | null>>>((value) => {
        setUploadTask(point.id, (current) => {
            if (current.ownerUid && current.ownerUid !== user?.uid) return current;
            const nextSubmission = typeof value === 'function' ? value(current.lastSubmission) : value;
            return {
                ...current,
                uploadSent: nextSubmission ? current.uploadSent : false,
                lastSubmission: nextSubmission,
                ownerUid: nextSubmission ? user?.uid ?? current.ownerUid : current.ownerUid,
                refreshedSubmissionKey: nextSubmission?.id === current.lastSubmission?.id
                    ? current.refreshedSubmissionKey
                    : null,
            };
        });
    }, [point.id, user?.uid]);

    const uploadFileToTarget = useCallback(async (file: File, uploadTarget: UGCUploadTarget | null) => {
        if (!file || !uploadTarget) return;

        const markerId = uploadTarget.id;
        const taskId = nextUploadTaskId++;
        const updateCurrentTask = (updater: (current: UploadTaskState) => UploadTaskState): void => {
            setUploadTask(markerId, (current) => {
                if (current.taskId !== taskId) return current;
                return updater(current);
            });
        };

        setUploadTask(markerId, () => ({
            markerId,
            taskId,
            uploading: true,
            uploadSent: false,
            progress: 0.02,
            error: null,
            lastSubmission: null,
            ownerUid: user?.uid ?? null,
            refreshedSubmissionKey: null,
            updatedAt: Date.now(),
        }));
        try {
            const submission = await uploadUGCImage(uploadTarget, file, (nextProgress) => {
                updateCurrentTask((current) => ({
                    ...current,
                    progress: nextProgress,
                }));
            }, () => {
                updateCurrentTask((current) => ({
                    ...current,
                    uploadSent: true,
                }));
            });
            updateCurrentTask((current) => ({
                ...current,
                lastSubmission: submission,
            }));
        } catch (err) {
            updateCurrentTask((current) => ({
                ...current,
                lastSubmission: null,
                uploadSent: false,
                error: errText(err),
            }));
        } finally {
            updateCurrentTask((current) => ({
                ...current,
                uploading: false,
                progress: 0,
            }));
        }
    }, [errText, user?.uid]);

    const uploadFile = useCallback(async (file: File) => {
        await uploadFileToTarget(file, target);
    }, [target, uploadFileToTarget]);

    const upload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        const uploadTarget = inputTargetRef.current ?? target;
        inputTargetRef.current = null;
        if (!file) return;
        await uploadFileToTarget(file, uploadTarget);
    }, [target, uploadFileToTarget]);

    const requestFileSelection = useCallback((uploadTarget: UGCUploadTarget | null) => {
        if (!uploadTarget || uploading) return;
        inputTargetRef.current = uploadTarget;
        setUploadTask(point.id, (current) => ({
            ...current,
            error: null,
        }));
        if (!user) {
            setPendingLoginUpload(true);
            openOemAuthModal('login');
            return;
        }
        inputRef.current?.click();
    }, [point.id, uploading, user]);

    const requestUpload = useCallback(() => {
        if (!canUpload) return;
        if (!target) return;
        requestFileSelection(target);
    }, [canUpload, requestFileSelection, target]);

    const requestAppendUpload = useCallback(() => {
        if (!canAppendUpload) return;
        if (!target) return;
        requestFileSelection(target);
    }, [canAppendUpload, requestFileSelection, target]);

    return {
        uploading,
        uploadSent,
        progress,
        error,
        lastSubmission,
        setLastSubmission,
        inputRef,
        canUpload,
        canAppendUpload,
        requestUpload,
        requestAppendUpload,
        upload,
        uploadFile,
    };
};

export default useUGCUpload;

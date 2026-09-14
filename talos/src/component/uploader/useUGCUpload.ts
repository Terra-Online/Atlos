import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuthStore } from '@/store/auth';
import { useTranslateUI } from '@/locale';
import { openOemAuthModal } from '@/component/login/authEvents';
import type { IMarkerData } from '@/data/marker';
import {
    listUGCImages,
    listUGCMyImages,
    uploadUGCImage,
    UGCClientError,
    type UGCUploadSubmission,
    type UGCUploadTarget,
} from '@/services/ugc/client';
import type { PointImagesState } from './useUGCPointImages';

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
};

const idleUploadTask: UploadTaskState = {
    markerId: '',
    taskId: null,
    uploading: false,
    uploadSent: false,
    progress: 0,
    error: null,
    lastSubmission: null,
};

const uploadTasks = new Map<string, UploadTaskState>();
const uploadTaskListeners = new Set<() => void>();
let nextUploadTaskId = 1;

const getUploadTask = (markerId: string): UploadTaskState => (
    uploadTasks.get(markerId) ?? idleUploadTask
);

const setUploadTask = (
    markerId: string,
    updater: (current: UploadTaskState) => UploadTaskState,
): void => {
    const current = uploadTasks.get(markerId) ?? { ...idleUploadTask, markerId };
    const next = updater(current);
    uploadTasks.set(markerId, next);
    uploadTaskListeners.forEach((listener) => listener());
};

const subscribeUploadTasks = (listener: () => void): (() => void) => {
    uploadTaskListeners.add(listener);
    return () => uploadTaskListeners.delete(listener);
};

const useUGCUpload = (point: IMarkerData, imageState: PointImagesState): UploadState => {
    const tUI = useTranslateUI();
    const user = useAuthStore((state) => state.sessionUser);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const inputTargetRef = useRef<UGCUploadTarget | null>(null);
    const [pendingLoginUpload, setPendingLoginUpload] = useState(false);
    const uploadTask = useSyncExternalStore(
        subscribeUploadTasks,
        () => getUploadTask(point.id),
        () => idleUploadTask,
    );

    const { target, loading, setImages, setMyImages, pendingOwn, active } = imageState;
    const { uploading, uploadSent, progress, error, lastSubmission } = uploadTask;
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
        if (!pendingLoginUpload || !user) return;
        setPendingLoginUpload(false);
        requestAnimationFrame(() => inputRef.current?.click());
    }, [pendingLoginUpload, user]);

    useEffect(() => {
        if (!lastSubmission) return;
        if (lastSubmission.markerId !== point.id) return;

        void Promise.allSettled([
            listUGCImages(point.id),
            listUGCMyImages(point.id),
        ]).then(([nextImages, nextMyImages]) => {
            if (nextImages.status === 'fulfilled') {
                setImages(nextImages.value);
            }
            if (nextMyImages.status === 'fulfilled') {
                setMyImages(nextMyImages.value);
            }
        });
    }, [lastSubmission, point.id, setImages, setMyImages]);

    const setLastSubmission = useCallback<React.Dispatch<React.SetStateAction<UGCUploadSubmission | null>>>((value) => {
        setUploadTask(point.id, (current) => {
            const nextSubmission = typeof value === 'function' ? value(current.lastSubmission) : value;
            return {
                ...current,
                uploadSent: nextSubmission ? current.uploadSent : false,
                lastSubmission: nextSubmission,
            };
        });
    }, [point.id]);

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
    }, [errText]);

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

import { useTranslateUI } from '@/locale';
import { useReportSync } from '@/component/ugc/useReportSync';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { openOemAuthModal } from '@/component/login/authEvents';
import {
    deleteUGCImage,
    invalidateUGCImageCache,
    invalidateUGCPublicImageCache,
    invalidateUGCSubmissionCache,
    toggleUGCImageFlag,
    toggleUGCImageUpvote,
    type UGCImageActionPatch,
} from '@/services/ugc/client';
import { getUpvoteCount, type PointImagesState } from './useUGCPointImages';
import type { UploadState } from './useUGCUpload';

const TOGGLE_SYNC_DELAY_MS = 300;
const DELETE_CONFIRM_MIN_DELAY_MS = 1_000;
const DELETE_CONFIRM_EXPIRE_MS = 5_000;

type ToggleTask = {
    desired: boolean;
    inFlight: boolean;
    lastSynced: boolean;
    timer?: number;
};

const getToggleTask = (
    tasks: Map<string, ToggleTask>,
    imageId: string,
    currentValue: boolean,
): ToggleTask => {
    const current = tasks.get(imageId);
    if (current) return current;
    const task = {
        desired: currentValue,
        inFlight: false,
        lastSynced: currentValue,
    };
    tasks.set(imageId, task);
    return task;
};

export type ImageActionsState = {
    reportError: string;
    actionPending: boolean;
    deleteConfirming: boolean;
    cancelDeleteConfirmation: () => void;
    handleToggleUpvote: () => void;
    handleToggleFlag: () => void;
    handleDelete: () => Promise<void>;
};

const useUGCImageActions = (imageState: PointImagesState, uploadState: UploadState): ImageActionsState => {
    const tUI = useTranslateUI();
    const [reportError, setReportError] = useState('');
    const user = useAuthStore((state) => state.sessionUser);
    const accountVersion = useAuthStore((state) => state.sessionVersion);
    const isAuthenticated = Boolean(user);
    const [actionPending, setActionPending] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        imageId: string;
        armedAt: number;
    } | null>(null);
    const cancelDeleteConfirmation = useCallback(() => setDeleteConfirmation(null), []);
    const upvoteTasksRef = useRef(new Map<string, ToggleTask>());

    const {
        active,
        refreshPublicImage,
        isOwnActive,
        applyServerImage,
        patchImageById,
        setImages,
        setMyImages,
        requestedImage,
        setRequestedImage,
        images,
        myImages,
        selectedImageId,
        setSelectedImageId,
        viewerOpen,
        setViewerOpen,
    } = imageState;

    const { lastSubmission, setLastSubmission } = uploadState;

    const scheduleUpvoteSync = useCallback((imageId: string) => {
        const task = upvoteTasksRef.current.get(imageId);
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
            void toggleUGCImageUpvote(imageId, sentState)
                .then((serverImage: UGCImageActionPatch) => {
                    task.lastSynced = sentState;
                    if (task.desired === sentState) {
                        applyServerImage(serverImage);
                    }
                })
                .catch(() => {
                    if (task.desired !== sentState) return;
                    task.desired = task.lastSynced;
                    patchImageById(imageId, (image) => {
                        const currentUpvoted = Boolean(image.upvoted);
                        if (currentUpvoted === task.lastSynced) return image;
                        const nextCount = Math.max(0, getUpvoteCount(image) + (task.lastSynced ? 1 : -1));
                        return {
                            ...image,
                            upvoted: task.lastSynced,
                            upvoteCount: nextCount,
                        };
                    });
                })
                .finally(() => {
                    task.inFlight = false;
                    if (task.desired !== task.lastSynced) {
                        scheduleUpvoteSync(imageId);
                    }
                });
        }, TOGGLE_SYNC_DELAY_MS);
    }, [applyServerImage, patchImageById]);

    const { start: syncFlag } = useReportSync({
        scope: `${active?.markerId ?? ''}:${accountVersion}`,
        delay: TOGGLE_SYNC_DELAY_MS,
        send: (target, desired) => toggleUGCImageFlag(target.id, desired, target.snapshotId),
        apply: (target, patch) => patchImageById(target.id, (image) => image.snapshotId === target.snapshotId ? { ...image, ...patch } : image),
        rollback: (target, original) => patchImageById(target.id, (image) => image.snapshotId === target.snapshotId ? {
            ...image, flagged: original.flagged, status: original.status,
        } : image),
        conflict: async (target) => {
            setReportError(tUI('detail.errors.reportVersionChanged'));
            await refreshPublicImage(target.id);
        },
    });

    useEffect(() => () => {
        upvoteTasksRef.current.forEach((task) => {
            if (task.timer) window.clearTimeout(task.timer);
        });
    }, []);

    useEffect(() => {
        cancelDeleteConfirmation();
    }, [active?.id, cancelDeleteConfirmation]);

    useEffect(() => {
        if (!viewerOpen) cancelDeleteConfirmation();
    }, [cancelDeleteConfirmation, viewerOpen]);

    useEffect(() => {
        if (!deleteConfirmation) return undefined;
        const remaining = DELETE_CONFIRM_EXPIRE_MS - (Date.now() - deleteConfirmation.armedAt);
        const timer = window.setTimeout(
            () => setDeleteConfirmation(null),
            Math.max(0, remaining),
        );
        return () => window.clearTimeout(timer);
    }, [deleteConfirmation]);

    const handleToggleUpvote = useCallback(() => {
        if (!active) return;
        if (!isAuthenticated) {
            openOemAuthModal('login');
            return;
        }
        const imageId = active.id;
        const nextUpvoted = !active.upvoted;
        const delta = nextUpvoted ? 1 : -1;
        patchImageById(imageId, (image) => ({
            ...image,
            upvoted: nextUpvoted,
            upvoteCount: Math.max(0, getUpvoteCount(image) + delta),
        }));
        const task = getToggleTask(upvoteTasksRef.current, imageId, Boolean(active.upvoted));
        task.desired = nextUpvoted;
        scheduleUpvoteSync(imageId);
    }, [active, isAuthenticated, patchImageById, scheduleUpvoteSync]);

    const handleToggleFlag = useCallback(() => {
        if (!active?.snapshotId || isOwnActive) return;
        if (!isAuthenticated) {
            openOemAuthModal('login');
            return;
        }
        const imageId = active.id;
        setReportError('');
        const nextFlagged = !active.flagged;
        patchImageById(imageId, (image) => ({
            ...image,
            flagged: nextFlagged,
            status: nextFlagged ? 'flagged' : image.status === 'flagged' ? 'active' : image.status,
        }));
        syncFlag({ id: imageId, snapshotId: active.snapshotId }, { flagged: Boolean(active.flagged), status: active.status }, nextFlagged);
    }, [active, isAuthenticated, isOwnActive, patchImageById, syncFlag]);

    const handleDelete = useCallback(async () => {
        if (!active || actionPending || !isOwnActive) return;
        if (!isAuthenticated) {
            openOemAuthModal('login');
            return;
        }
        const now = Date.now();
        if (deleteConfirmation?.imageId !== active.id) {
            setDeleteConfirmation({ imageId: active.id, armedAt: now });
            return;
        }
        if (now - deleteConfirmation.armedAt < DELETE_CONFIRM_MIN_DELAY_MS) return;
        setDeleteConfirmation(null);

        const accountVersion = useAuthStore.getState().sessionVersion;
        const previousSubmission = lastSubmission;
        const previousImages = images;
        const previousMyImages = myImages;
        const previousRequestedImage = requestedImage;
        const previousSelectedImageId = selectedImageId;
        const previousViewerOpen = viewerOpen;
        setLastSubmission(null);
        setImages((current) => current.filter((image) => image.id !== active.id));
        setMyImages((current) => current.filter((image) => image.id !== active.id));
        setRequestedImage((current) => (current?.id === active.id ? null : current));
        setSelectedImageId(null);
        setViewerOpen(false);
        setActionPending(true);
        try {
            await deleteUGCImage(active.id);
            invalidateUGCImageCache(active.markerId);
            invalidateUGCPublicImageCache(active.markerId);
            invalidateUGCSubmissionCache(active.markerId);
        } catch {
            if (useAuthStore.getState().sessionVersion !== accountVersion) return;
            setLastSubmission(previousSubmission);
            setImages(previousImages);
            setMyImages(previousMyImages);
            setRequestedImage(previousRequestedImage);
            setSelectedImageId(previousSelectedImageId);
            setViewerOpen(previousViewerOpen);
        } finally {
            setActionPending(false);
        }
    }, [actionPending, active, images, isAuthenticated, isOwnActive, lastSubmission, myImages, deleteConfirmation, requestedImage, selectedImageId, setImages, setLastSubmission, setMyImages, setRequestedImage, setSelectedImageId, setViewerOpen, viewerOpen]);

    return {
        reportError,
        actionPending,
        deleteConfirming: Boolean(active && deleteConfirmation?.imageId === active.id),
        cancelDeleteConfirmation,
        handleToggleUpvote,
        handleToggleFlag,
        handleDelete,
    };
};

export default useUGCImageActions;

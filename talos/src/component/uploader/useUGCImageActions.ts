import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { openOemAuthModal } from '@/component/login/authEvents';
import {
    recallUGCImage,
    toggleUGCImageFlag,
    toggleUGCImageUpvote,
    type UGCImage,
    type UGCImageActionPatch,
    type UGCSubmissionImage,
} from '@/services/ugc/client';
import { getUpvoteCount, type PointImagesState } from './useUGCPointImages';
import type { UploadState } from './useUGCUpload';

const TOGGLE_SYNC_DELAY_MS = 300;
const RECALL_CONFIRM_MIN_DELAY_MS = 1_000;
const RECALL_CONFIRM_EXPIRE_MS = 5_000;

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
    actionPending: boolean;
    recallConfirming: boolean;
    cancelRecallConfirmation: () => void;
    viewerOpen: boolean;
    setViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;
    handleToggleUpvote: () => void;
    handleToggleFlag: () => void;
    handleToggleRecall: () => Promise<void>;
};

const useUGCImageActions = (imageState: PointImagesState, uploadState: UploadState): ImageActionsState => {
    const user = useAuthStore((state) => state.sessionUser);
    const isAuthenticated = Boolean(user);
    const [actionPending, setActionPending] = useState(false);
    const [recallConfirmation, setRecallConfirmation] = useState<{
        imageId: string;
        armedAt: number;
    } | null>(null);
    const [viewerOpen, setViewerOpen] = useState(false);
    const cancelRecallConfirmation = useCallback(() => setRecallConfirmation(null), []);
    const upvoteTasksRef = useRef(new Map<string, ToggleTask>());
    const flagTasksRef = useRef(new Map<string, ToggleTask>());

    const {
        active,
        isOwnActive,
        applyServerImage,
        setImages,
        setMyImages,
        images,
        myImages,
        selectedImageId,
        setSelectedImageId,
    } = imageState;

    const { lastSubmission, setLastSubmission } = uploadState;

    const patchImageById = useCallback((imageId: string, patch: (image: UGCImage) => UGCImage) => {
        setImages((current) => current.map((image) => (image.id === imageId ? patch(image) : image)));
        setMyImages((current) => current.map((image) => (image.id === imageId ? patch(image) as UGCSubmissionImage : image)));
    }, [setImages, setMyImages]);

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
                            upvotes: nextCount,
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

    const scheduleFlagSync = useCallback((imageId: string) => {
        const task = flagTasksRef.current.get(imageId);
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
            void toggleUGCImageFlag(imageId, sentState)
                .then((serverImage: UGCImageActionPatch) => {
                    task.lastSynced = sentState;
                    if (task.desired === sentState) {
                        applyServerImage(serverImage);
                    }
                })
                .catch(() => {
                    if (task.desired !== sentState) return;
                    task.desired = task.lastSynced;
                    patchImageById(imageId, (image) => ({
                        ...image,
                        flagged: task.lastSynced,
                        status: task.lastSynced ? 'flagged' : image.status === 'flagged' ? 'active' : image.status,
                    }));
                })
                .finally(() => {
                    task.inFlight = false;
                    if (task.desired !== task.lastSynced) {
                        scheduleFlagSync(imageId);
                    }
                });
        }, TOGGLE_SYNC_DELAY_MS);
    }, [applyServerImage, patchImageById]);

    useEffect(() => () => {
        upvoteTasksRef.current.forEach((task) => {
            if (task.timer) window.clearTimeout(task.timer);
        });
        flagTasksRef.current.forEach((task) => {
            if (task.timer) window.clearTimeout(task.timer);
        });
    }, []);

    useEffect(() => {
        cancelRecallConfirmation();
    }, [active?.id, cancelRecallConfirmation]);

    useEffect(() => {
        if (!viewerOpen) cancelRecallConfirmation();
    }, [cancelRecallConfirmation, viewerOpen]);

    useEffect(() => {
        if (!recallConfirmation) return undefined;
        const remaining = RECALL_CONFIRM_EXPIRE_MS - (Date.now() - recallConfirmation.armedAt);
        const timer = window.setTimeout(
            () => setRecallConfirmation(null),
            Math.max(0, remaining),
        );
        return () => window.clearTimeout(timer);
    }, [recallConfirmation]);

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
            upvotes: Math.max(0, getUpvoteCount(image) + delta),
            upvoteCount: Math.max(0, getUpvoteCount(image) + delta),
        }));
        const task = getToggleTask(upvoteTasksRef.current, imageId, Boolean(active.upvoted));
        task.desired = nextUpvoted;
        scheduleUpvoteSync(imageId);
    }, [active, isAuthenticated, patchImageById, scheduleUpvoteSync]);

    const handleToggleFlag = useCallback(() => {
        if (!active || isOwnActive) return;
        if (!isAuthenticated) {
            openOemAuthModal('login');
            return;
        }
        const imageId = active.id;
        const nextFlagged = !active.flagged;
        patchImageById(imageId, (image) => ({
            ...image,
            flagged: nextFlagged,
            status: nextFlagged ? 'flagged' : image.status === 'flagged' ? 'active' : image.status,
        }));
        const task = getToggleTask(flagTasksRef.current, imageId, Boolean(active.flagged));
        task.desired = nextFlagged;
        scheduleFlagSync(imageId);
    }, [active, isAuthenticated, isOwnActive, patchImageById, scheduleFlagSync]);

    const handleToggleRecall = useCallback(async () => {
        if (!active || actionPending || !isOwnActive) return;
        if (!isAuthenticated) {
            openOemAuthModal('login');
            return;
        }
        const now = Date.now();
        if (recallConfirmation?.imageId !== active.id) {
            setRecallConfirmation({ imageId: active.id, armedAt: now });
            return;
        }
        if (now - recallConfirmation.armedAt < RECALL_CONFIRM_MIN_DELAY_MS) return;
        setRecallConfirmation(null);

        const previousSubmission = lastSubmission;
        const previousImages = images;
        const previousMyImages = myImages;
        const previousSelectedImageId = selectedImageId;
        const previousViewerOpen = viewerOpen;
        setLastSubmission(null);
        setImages((current) => current.filter((image) => image.id !== active.id));
        setMyImages((current) => current.filter((image) => image.id !== active.id));
        setSelectedImageId(null);
        setViewerOpen(false);
        setActionPending(true);
        try {
            await recallUGCImage(active.id);
        } catch {
            setLastSubmission(previousSubmission);
            setImages(previousImages);
            setMyImages(previousMyImages);
            setSelectedImageId(previousSelectedImageId);
            setViewerOpen(previousViewerOpen);
        } finally {
            setActionPending(false);
        }
    }, [actionPending, active, images, isAuthenticated, isOwnActive, lastSubmission, myImages, recallConfirmation, selectedImageId, setImages, setLastSubmission, setMyImages, setSelectedImageId, viewerOpen]);

    return {
        actionPending,
        recallConfirming: Boolean(active && recallConfirmation?.imageId === active.id),
        cancelRecallConfirmation,
        viewerOpen,
        setViewerOpen,
        handleToggleUpvote,
        handleToggleFlag,
        handleToggleRecall,
    };
};

export default useUGCImageActions;

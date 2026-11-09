import { useReportSync } from '@/component/ugc/useReportSync';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { openOemAuthModal } from '@/component/shared/account/authEvents';
import {
    deleteUGCImage,
    invalidateUGCImageCache,
    invalidateUGCPublicImageCache,
    invalidateUGCSubmissionCache,
    toggleUGCImageFlag,
    toggleUGCImageUpvote,
    type UGCImageActionPatch,
} from '@/services/ugc/client';
import { getUpvoteCount, type PointImagesState } from '@/pages/uploader/useUGCPointImages';
import type { UploadState } from '@/pages/uploader/useUGCUpload';

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
    actionPending: boolean;
    deleteConfirming: boolean;
    cancelDeleteConfirmation: () => void;
    handleToggleUpvote: () => void;
    handleToggleFlag: () => void;
    handleDelete: () => Promise<void>;
};

const useUGCImageActions = (imageState: PointImagesState, uploadState: UploadState): ImageActionsState => {
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
    const scope = useMemo(() => ({ uid: user?.uid, pointId: imageState.target?.id, sessionVersion: accountVersion }), [user?.uid, imageState.target?.id, accountVersion]);
    const currentScopeRef = useRef<typeof scope | null>(scope);
    currentScopeRef.current = scope;
    const isCurrent = useCallback(() => currentScopeRef.current === scope
        && useAuthStore.getState().sessionVersion === scope.sessionVersion, [scope]);

    const {
        active,
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
            if (!isCurrent()) return;
            if (task.inFlight) return;
            if (task.desired === task.lastSynced) return;

            const sentState = task.desired;
            task.inFlight = true;
            void toggleUGCImageUpvote(imageId, sentState)
                .then((serverImage: UGCImageActionPatch) => {
                    if (upvoteTasksRef.current.get(imageId) !== task || !isCurrent()) return;
                    task.lastSynced = sentState;
                    if (task.desired === sentState) {
                        applyServerImage(serverImage);
                    }
                })
                .catch(() => {
                    if (upvoteTasksRef.current.get(imageId) !== task || !isCurrent()) return;
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
                    if (upvoteTasksRef.current.get(imageId) !== task || !isCurrent()) return;
                    task.inFlight = false;
                    if (task.desired !== task.lastSynced) {
                        scheduleUpvoteSync(imageId);
                    }
                });
        }, TOGGLE_SYNC_DELAY_MS);
    }, [applyServerImage, isCurrent, patchImageById]);

    const { start: syncFlag } = useReportSync({
        scope: `${active?.markerId ?? ''}:${accountVersion}`,
        delay: TOGGLE_SYNC_DELAY_MS,
        send: (target, desired) => toggleUGCImageFlag(target.id, desired),
        apply: (target, patch) => patchImageById(target.id, (image) => ({
            ...image,
            ...patch,
            status: image.status === 'active' || image.status === 'flagged' ? patch.status ?? image.status : image.status,
        })),
        rollback: (target, original) => patchImageById(target.id, (image) => ({
            ...image,
            flagged: original.flagged,
            status: image.status === 'active' || image.status === 'flagged' ? original.status : image.status,
        })),
    });

    useEffect(() => {
        currentScopeRef.current = scope;
        setActionPending(false);
        cancelDeleteConfirmation();
        const upvotes = upvoteTasksRef.current;
        return () => {
            if (currentScopeRef.current === scope) currentScopeRef.current = null;
            upvotes.forEach((task) => { if (task.timer) window.clearTimeout(task.timer); });
            upvotes.clear();
        };
    }, [scope, cancelDeleteConfirmation]);

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
        if (!active || !isCurrent()) return;
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
    }, [active, isAuthenticated, isCurrent, patchImageById, scheduleUpvoteSync]);

    const handleToggleFlag = useCallback(() => {
        if (!active || isOwnActive || !isCurrent()) return;
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
        syncFlag({ id: imageId }, { flagged: Boolean(active.flagged), status: active.status }, nextFlagged);
    }, [active, isAuthenticated, isCurrent, isOwnActive, patchImageById, syncFlag]);

    const handleDelete = useCallback(async () => {
        if (!active || actionPending || !isOwnActive || !isCurrent()) return;
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
            if (!isCurrent()) return;
            setLastSubmission(previousSubmission);
            setImages(previousImages);
            setMyImages(previousMyImages);
            setRequestedImage(previousRequestedImage);
            setSelectedImageId(previousSelectedImageId);
            setViewerOpen(previousViewerOpen);
        } finally {
            if (isCurrent()) setActionPending(false);
        }
    }, [actionPending, active, images, isAuthenticated, isCurrent, isOwnActive, lastSubmission, myImages, deleteConfirmation, requestedImage, selectedImageId, setImages, setLastSubmission, setMyImages, setRequestedImage, setSelectedImageId, setViewerOpen, viewerOpen]);

    return {
        actionPending,
        deleteConfirming: Boolean(active && deleteConfirmation?.imageId === active.id),
        cancelDeleteConfirmation,
        handleToggleUpvote,
        handleToggleFlag,
        handleDelete,
    };
};

export default useUGCImageActions;

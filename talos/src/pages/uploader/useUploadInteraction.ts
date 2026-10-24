import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { openOemAuthModal } from '@/component/shared/account/authEvents';
import { getAppDocument, subscribePictureInPictureState } from '@/platform/pictureInPicture';
import type { IMarkerData } from '@/data/marker';
import type { UploadState } from '@/pages/uploader/useUGCUpload';

export type UploadInteractionState = {
    dragActive: boolean;
    handleDragEnter: (event: React.DragEvent<HTMLDivElement>) => void;
    handleDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
    handleDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
    handleDrop: (event: React.DragEvent<HTMLDivElement>) => void;
};

const hasDraggedFiles = (event: React.DragEvent<HTMLDivElement>): boolean => (
    Array.from(event.dataTransfer.types).includes('Files')
);

const useUploadInteraction = (
    point: IMarkerData,
    uploadState: UploadState,
    activeDetail: boolean,
    viewerOpen: boolean,
): UploadInteractionState => {
    const user = useAuthStore((state) => state.sessionUser);
    const isAuthenticated = Boolean(user);
    const { canUpload, uploading, uploadFile } = uploadState;

    const pendingUploadFileRef = useRef<File | null>(null);
    const dragDepthRef = useRef(0);
    const [appDocumentVersion, setAppDocumentVersion] = useState(0);
    const [dragActive, setDragActive] = useState(false);

    useEffect(() => subscribePictureInPictureState(() => {
        setAppDocumentVersion((version) => version + 1);
    }), []);

    useEffect(() => {
        pendingUploadFileRef.current = null;
        dragDepthRef.current = 0;
        setDragActive(false);
    }, [point.id]);

    // Resume upload after login
    useEffect(() => {
        if (!activeDetail || !canUpload || !isAuthenticated || uploading) return;
        const file = pendingUploadFileRef.current;
        if (!file) return;
        pendingUploadFileRef.current = null;
        void uploadFile(file);
    }, [activeDetail, canUpload, isAuthenticated, uploadFile, uploading]);

    // Clipboard paste
    const handleClipboardUpload = useCallback(async (file: File) => {
        if (!file) return;
        if (!isAuthenticated) {
            pendingUploadFileRef.current = file;
            openOemAuthModal('login');
            return;
        }
        await uploadFile(file);
    }, [isAuthenticated, uploadFile]);

    useEffect(() => {
        if (!activeDetail || !canUpload || uploading || viewerOpen) return undefined;
        const activeDocument = getAppDocument();

        const handlePaste = (event: ClipboardEvent) => {
            const items = Array.from(event.clipboardData?.items ?? []);
            const file = items
                .filter((item) => item.kind === 'file')
                .map((item) => item.getAsFile())
                .find((item): item is File => Boolean(item));

            if (!file) return;
            event.preventDefault();
            void handleClipboardUpload(file);
        };

        activeDocument.addEventListener('paste', handlePaste);
        return () => activeDocument.removeEventListener('paste', handlePaste);
    }, [activeDetail, appDocumentVersion, canUpload, handleClipboardUpload, uploading, viewerOpen]);

    // Drag state reset
    useEffect(() => {
        if (activeDetail && canUpload && !uploading && !viewerOpen) return;
        dragDepthRef.current = 0;
        setDragActive(false);
    }, [activeDetail, canUpload, uploading, viewerOpen]);

    const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        if (!activeDetail || !canUpload || uploading || viewerOpen) return;
        dragDepthRef.current += 1;
        setDragActive(true);
    }, [activeDetail, canUpload, uploading, viewerOpen]);

    const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = activeDetail && canUpload && !uploading && !viewerOpen ? 'copy' : 'none';
    }, [activeDetail, canUpload, uploading, viewerOpen]);

    const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        if (!activeDetail || !canUpload || uploading || viewerOpen) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
            setDragActive(false);
        }
    }, [activeDetail, canUpload, uploading, viewerOpen]);

    const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragActive(false);
        if (!activeDetail || !canUpload || uploading || viewerOpen) return;

        const file = event.dataTransfer.files[0];
        if (!file) return;

        if (!isAuthenticated) {
            pendingUploadFileRef.current = file;
            openOemAuthModal('login');
            return;
        }

        void uploadFile(file);
    }, [activeDetail, canUpload, isAuthenticated, uploadFile, uploading, viewerOpen]);

    return {
        dragActive,
        handleDragEnter,
        handleDragOver,
        handleDragLeave,
        handleDrop,
    };
};

export default useUploadInteraction;

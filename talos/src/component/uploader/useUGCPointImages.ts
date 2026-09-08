import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { useMarkerStore } from '@/store/marker';
import type { IMarkerData } from '@/data/marker';
import { parseTimestamp } from '@/utils/timeFormat';
import {
    getUGCImageById,
    listUGCImages,
    listUGCMyImages,
    resolveUGCUploadTarget,
    type UGCImage,
    type UGCImageActionPatch,
    type UGCSubmissionImage,
} from '@/utils/ugcClient';

const isPendingStatus = (status: UGCSubmissionImage['status'] | UGCImage['status']): boolean => (
    status === 'pending_openai' || status === 'pending_audit'
);

export const isPending = (image: Pick<UGCSubmissionImage, 'status'> | Pick<UGCImage, 'status'>): boolean => (
    isPendingStatus(image.status)
);

export const isPublic = (image: Pick<UGCSubmissionImage, 'status'> | Pick<UGCImage, 'status'>): boolean => (
    image.status === 'active' || image.status === 'flagged' || image.status === 'remove_request'
);

export const getUpvoteCount = (image: UGCImage): number => (
    Number.isFinite(image.upvotes)
        ? Math.max(0, image.upvotes as number)
        : Number.isFinite(image.upvoteCount)
            ? Math.max(0, image.upvoteCount as number)
            : 0
);

const getImageCreatedAtTime = (image: UGCImage): number => {
    return parseTimestamp(image.createdAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
};

export type PointImagesState = {
    images: UGCImage[];
    myImages: UGCSubmissionImage[];
    setImages: React.Dispatch<React.SetStateAction<UGCImage[]>>;
    setMyImages: React.Dispatch<React.SetStateAction<UGCSubmissionImage[]>>;
    activeImages: UGCImage[];
    active: UGCImage | null;
    selectedImageId: string | null;
    setSelectedImageId: React.Dispatch<React.SetStateAction<string | null>>;
    isOwnActive: boolean;
    isActivePending: boolean;
    pendingOwn: UGCSubmissionImage | null;
    pointImages: UGCImage[];
    pointMyImages: UGCSubmissionImage[];
    loading: boolean;
    show: boolean;
    target: ReturnType<typeof resolveUGCUploadTarget>;
    patchActiveImage: (patch: (image: UGCImage) => UGCImage) => void;
    applyServerImage: (serverImage: UGCImageActionPatch) => void;
    shouldOpenViewer: boolean;
    acknowledgeViewerOpen: () => void;
};

const useUGCPointImages = (point: IMarkerData): PointImagesState => {
    const user = useAuthStore((state) => state.sessionUser);
    const target = useMemo(() => resolveUGCUploadTarget(point), [point]);
    const [images, setImages] = useState<UGCImage[]>([]);
    const [myImages, setMyImages] = useState<UGCSubmissionImage[]>([]);
    const [requestedImage, setRequestedImage] = useState<UGCImage | null>(null);
    const [publicImagesLoading, setPublicImagesLoading] = useState(true);
    const [myImagesLoading, setMyImagesLoading] = useState(Boolean(user));
    const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
    const [shouldOpenViewer, setShouldOpenViewer] = useState(false);
    const imageOpenRequest = useMarkerStore((state) => state.imageOpenRequest);
    const clearImageOpenRequest = useMarkerStore((state) => state.clearImageOpenRequest);

    useEffect(() => {
        setImages([]);
        setRequestedImage(null);
        setSelectedImageId(null);
        setShouldOpenViewer(false);
        if (!target) {
            setPublicImagesLoading(false);
            return;
        }

        // This flag belongs to this effect run. It ignores late results from an
        // old marker load; it does not abort the underlying HTTP request.
        let disposed = false;
        setPublicImagesLoading(true);
        void listUGCImages(point.id)
            .then((nextImages) => {
                if (!disposed) setImages(nextImages);
            })
            .catch(() => {
                if (!disposed) setImages([]);
            })
            .finally(() => {
                if (!disposed) setPublicImagesLoading(false);
            });

        return () => {
            disposed = true;
        };
    }, [point.id, target]);

    useEffect(() => {
        setMyImages([]);
        if (!target || !user) {
            setMyImagesLoading(false);
            return;
        }

        let disposed = false;
        setMyImagesLoading(true);
        void listUGCMyImages(point.id)
            .then((nextImages) => {
                if (!disposed) setMyImages(nextImages);
            })
            .catch(() => {
                if (!disposed) setMyImages([]);
            })
            .finally(() => {
                if (!disposed) setMyImagesLoading(false);
            });

        return () => {
            disposed = true;
        };
    }, [point.id, target, user]);

    const pointImages = useMemo(() => {
        const merged = new Map(
            images
                .filter((image) => image.markerId === point.id)
                .map((image) => [image.id, image] as const),
        );
        if (requestedImage?.markerId === point.id) {
            merged.set(requestedImage.id, requestedImage);
        }
        return [...merged.values()];
    }, [images, point.id, requestedImage]);
    const pointMyImages = useMemo(
        () => myImages.filter((image) => image.markerId === point.id),
        [myImages, point.id],
    );

    // Merge public and own records by ID so the UI has one display list.
    const activeImages = useMemo(() => {
        const merged = new Map<string, UGCImage>();
        pointImages.forEach((image) => {
            const ownMatch = pointMyImages.find((myImage) => myImage.id === image.id);
            merged.set(image.id, ownMatch
                ? {
                    ...image,
                    ...ownMatch,
                    author: image.author ?? ownMatch.author,
                    url: image.url || ownMatch.url,
                }
                : image);
        });

        pointMyImages
            .filter((image) => isPending(image) || isPublic(image))
            .forEach((image) => {
                const current = merged.get(image.id);
                merged.set(image.id, current
                    ? {
                        ...current,
                        ...image,
                        author: current.author ?? image.author,
                        url: current.url || image.url,
                    }
                    : image);
            });

        return [...merged.values()].sort((a, b) => {
            const pendingDelta = Number(isPending(b)) - Number(isPending(a));
            if (pendingDelta !== 0) return pendingDelta;
            return getImageCreatedAtTime(b) - getImageCreatedAtTime(a);
        });
    }, [pointImages, pointMyImages]);

    const active = useMemo(() => {
        if (activeImages.length === 0) return null;
        return activeImages.find((image) => image.id === selectedImageId) ?? activeImages[0];
    }, [activeImages, selectedImageId]);

    useEffect(() => {
        if (activeImages.length === 0) {
            setSelectedImageId(null);
            return;
        }
        if (selectedImageId && activeImages.some((image) => image.id === selectedImageId)) return;
        setSelectedImageId(activeImages[0].id);
    }, [activeImages, selectedImageId]);

    const isOwnActive = Boolean(active && pointMyImages.some((image) => image.id === active.id));
    const isActivePending = Boolean(active && isPending(active));
    const pendingOwn = useMemo(
        () => pointMyImages.find(isPending) ?? null,
        [pointMyImages],
    );

    const loading = publicImagesLoading || myImagesLoading;

    useEffect(() => {
        if (!imageOpenRequest || imageOpenRequest.markerId !== point.id) {
            return;
        }
        const { imageId } = imageOpenRequest;
        setRequestedImage(null);
        setShouldOpenViewer(false);
        let cancelled = false;
        void getUGCImageById(point.id, imageId)
            .then((image) => {
                if (cancelled) return;
                setRequestedImage(image);
                setSelectedImageId(image.id);
                setShouldOpenViewer(true);
                clearImageOpenRequest();
            })
            .catch(() => {
                if (cancelled) return;
                clearImageOpenRequest();
            });

        return () => {
            cancelled = true;
        };
    }, [clearImageOpenRequest, imageOpenRequest, point.id]);

    const acknowledgeViewerOpen = useCallback(() => {
        // This only acknowledges the one-time signal; it does not close the viewer.
        setShouldOpenViewer(false);
    }, []);

    const patchActiveImage = useCallback((patch: (image: UGCImage) => UGCImage) => {
        if (!active) return;
        setImages((current) => current.map((image) => (image.id === active.id ? patch(image) : image)));
        setMyImages((current) => current.map((image) => (image.id === active.id ? patch(image) as UGCSubmissionImage : image)));
        setRequestedImage((current) => (current?.id === active.id ? patch(current) : current));
    }, [active]);

    const applyServerImage = useCallback((serverImage: UGCImageActionPatch) => {
        setImages((current) => current.map((image) => (image.id === serverImage.id ? {
            ...image,
            ...serverImage,
        } : image)));
        setMyImages((current) => current.map((image) => (image.id === serverImage.id ? {
            ...image,
            ...serverImage,
            status: (serverImage as UGCSubmissionImage).status ?? image.status,
        } : image)));
        setRequestedImage((current) => (current?.id === serverImage.id
            ? { ...current, ...serverImage }
            : current));
    }, []);

    return {
        images,
        myImages,
        setImages,
        setMyImages,
        activeImages,
        active,
        selectedImageId,
        setSelectedImageId,
        isOwnActive,
        isActivePending,
        pendingOwn,
        pointImages,
        pointMyImages,
        loading,
        show: Boolean(target) || pointImages.length > 0,
        target,
        patchActiveImage,
        applyServerImage,
        shouldOpenViewer,
        acknowledgeViewerOpen,
    };
};

export default useUGCPointImages;

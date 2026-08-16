import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import type { IMarkerData } from '@/data/marker';
import { parseTimestamp } from '@/lib/format/time';
import {
    listUGCImages,
    listUGCMyImages,
    resolveUGCUploadTarget,
    type UGCImage,
    type UGCImageActionPatch,
    type UGCSubmissionImage,
} from '@/services/ugc/client';

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
};

const useUGCPointImages = (point: IMarkerData): PointImagesState => {
    const user = useAuthStore((state) => state.sessionUser);
    const target = useMemo(() => resolveUGCUploadTarget(point), [point]);
    const [images, setImages] = useState<UGCImage[]>([]);
    const [myImages, setMyImages] = useState<UGCSubmissionImage[]>([]);
    const [publicImagesLoading, setPublicImagesLoading] = useState(false);
    const [myImagesLoading, setMyImagesLoading] = useState(false);
    const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

    useEffect(() => {
        setImages([]);
        setMyImages([]);
        setSelectedImageId(null);
        setPublicImagesLoading(false);
        setMyImagesLoading(false);
        if (!target) return;

        let disposed = false;
        setPublicImagesLoading(true);
        setMyImagesLoading(Boolean(user));
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

        if (user) {
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
        }

        return () => {
            disposed = true;
        };
    }, [point.id, target, user]);

    const pointImages = useMemo(
        () => images.filter((image) => image.markerId === point.id),
        [images, point.id],
    );
    const pointMyImages = useMemo(
        () => myImages.filter((image) => image.markerId === point.id),
        [myImages, point.id],
    );

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

    const patchActiveImage = useCallback((patch: (image: UGCImage) => UGCImage) => {
        if (!active) return;
        setImages((current) => current.map((image) => (image.id === active.id ? patch(image) : image)));
        setMyImages((current) => current.map((image) => (image.id === active.id ? patch(image) as UGCSubmissionImage : image)));
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
    };
};

export default useUGCPointImages;

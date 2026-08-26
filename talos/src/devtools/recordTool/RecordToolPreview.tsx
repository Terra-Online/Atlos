import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TalosMap } from '@/component/mapCore/engine';
import type { IMarkerData } from '@/data/marker';
import { useTranslateGame } from '@/locale';
import { getAppViewport } from '@/component/scale/pip';
import PopoverTooltip from '@/component/popover/popover';
import { useAppViewport } from '@/utils/device';
import { parseTimestamp } from '@/utils/timeFormat';
import {
    listRecordToolUGCImages,
    peekRecordToolUGCImages,
    type UGCImage,
} from './ugcClient';
import {
    MARKER_PREVIEW_ENTER_EVENT,
    MARKER_PREVIEW_LEAVE_EVENT,
    type PreviewEnterDetail,
    type PreviewLeaveDetail,
} from '@/component/map/PreviewEvents';
import styles from '@/component/map/Preview.module.scss';

type PreviewMarkerState = {
    marker: IMarkerData;
    left: number;
    top: number;
    previewUrl: string | null;
};

interface UsePreviewResult {
    PreviewElement: ReactNode;
}

const PREVIEW_HIDE_DELAY_MS = 500;

const getPreviewUpvoteCount = (image: UGCImage): number => (
    Number.isFinite(image.upvotes)
        ? Math.max(0, image.upvotes as number)
        : Number.isFinite(image.upvoteCount)
            ? Math.max(0, image.upvoteCount as number)
            : 0
);

const getPreviewCreatedAtTime = (image: UGCImage): number => {
    return parseTimestamp(image.createdAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
};

const selectPreviewImage = (images: UGCImage[]): UGCImage | null => (
    images
        .slice()
        .sort((a, b) => {
            const upvoteDelta = getPreviewUpvoteCount(b) - getPreviewUpvoteCount(a);
            if (upvoteDelta !== 0) return upvoteDelta;
            return getPreviewCreatedAtTime(a) - getPreviewCreatedAtTime(b);
        })[0] ?? null
);

export const UseRecordToolPreview = (map: TalosMap | null): UsePreviewResult => {
    const tGame = useTranslateGame();
    const viewport = useAppViewport();
    const requestTokenRef = useRef(0);
    const markerRequestTokensRef = useRef(new Map<string, number>());
    const previewHideTimeoutsRef = useRef(new Map<string, number>());
    const [previewMarkers, setPreviewMarkers] = useState<PreviewMarkerState[]>([]);
    const previewEnabled = !viewport.isPipUiTooSmall;

    const clearPreviewHide = useCallback((markerId: string) => {
        const timeout = previewHideTimeoutsRef.current.get(markerId);
        if (timeout === undefined) return;
        window.clearTimeout(timeout);
        previewHideTimeoutsRef.current.delete(markerId);
    }, []);

    const clearAllPreviewHides = useCallback(() => {
        previewHideTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
        previewHideTimeoutsRef.current.clear();
    }, []);

    const clearPreviews = useCallback(() => {
        clearAllPreviewHides();
        requestTokenRef.current += 1;
        markerRequestTokensRef.current.clear();
        setPreviewMarkers([]);
    }, [clearAllPreviewHides]);

    useEffect(() => {
        if (viewport.isPipUiTooSmall) clearPreviews();
    }, [clearPreviews, viewport.isPipUiTooSmall]);

    const updateMarkerPosition = useCallback((marker: IMarkerData) => {
        if (!map) return null;
        const point = map.latLngToContainerPoint(marker.pos);
        const rect = map.getContainer().getBoundingClientRect();
        return {
            left: rect.left + point.x,
            top: rect.top + point.y,
        };
    }, [map]);

    const removePreview = useCallback((markerId: string, requestToken: number) => {
        if (markerRequestTokensRef.current.get(markerId) !== requestToken) return;
        setPreviewMarkers((current) => current.filter((item) => item.marker.id !== markerId));
    }, []);

    const showPreviewFromImages = useCallback((
        marker: IMarkerData,
        requestToken: number,
        images: UGCImage[],
    ) => {
        if (markerRequestTokensRef.current.get(marker.id) !== requestToken) return;
        const activeImage = selectPreviewImage(images);
        if (!activeImage) {
            removePreview(marker.id, requestToken);
            return;
        }

        const previewUrl = activeImage.url;
        const preloadImage = new Image();
        preloadImage.onload = () => {
            if (markerRequestTokensRef.current.get(marker.id) !== requestToken) return;
            const settledPosition = updateMarkerPosition(marker);
            if (!settledPosition) return;
            setPreviewMarkers((current) => current.map((item) => (
                item.marker.id === marker.id
                    ? { ...item, ...settledPosition, previewUrl }
                    : item
            )));
        };
        preloadImage.onerror = () => removePreview(marker.id, requestToken);
        preloadImage.src = previewUrl;
    }, [removePreview, updateMarkerPosition]);

    useEffect(() => {
        if (!map) return;

        const onEnter = (event: Event) => {
            if (!previewEnabled || getAppViewport().isPipUiTooSmall) return;
            const marker = (event as CustomEvent<PreviewEnterDetail>).detail?.marker;
            if (!marker) return;

            clearPreviewHide(marker.id);
            const position = updateMarkerPosition(marker);
            if (!position) return;

            const requestToken = requestTokenRef.current + 1;
            requestTokenRef.current = requestToken;
            markerRequestTokensRef.current.set(marker.id, requestToken);
            setPreviewMarkers((current) => {
                const next = current.filter((item) => item.marker.id !== marker.id);
                next.push({ marker, ...position, previewUrl: null });
                return next;
            });

            const cachedImages = peekRecordToolUGCImages(marker.id);
            if (cachedImages) {
                showPreviewFromImages(marker, requestToken, cachedImages);
                return;
            }

            void listRecordToolUGCImages(marker.id)
                .then((images) => showPreviewFromImages(marker, requestToken, images))
                .catch(() => removePreview(marker.id, requestToken));
        };

        const onLeave = (event: Event) => {
            const markerId = (event as CustomEvent<PreviewLeaveDetail>).detail?.markerId;
            if (!markerId) return;
            const requestToken = markerRequestTokensRef.current.get(markerId);
            if (requestToken === undefined) return;

            clearPreviewHide(markerId);
            const timeout = window.setTimeout(() => {
                previewHideTimeoutsRef.current.delete(markerId);
                removePreview(markerId, requestToken);
            }, PREVIEW_HIDE_DELAY_MS);
            previewHideTimeoutsRef.current.set(markerId, timeout);
        };

        const syncPosition = () => {
            setPreviewMarkers((current) => current.map((item) => {
                const position = updateMarkerPosition(item.marker);
                return position ? { ...item, ...position } : item;
            }));
        };

        window.addEventListener(MARKER_PREVIEW_ENTER_EVENT, onEnter as EventListener);
        window.addEventListener(MARKER_PREVIEW_LEAVE_EVENT, onLeave as EventListener);
        map.on('move', syncPosition);
        map.on('zoom', syncPosition);
        map.on('talos:regionSwitched', clearPreviews);

        return () => {
            window.removeEventListener(MARKER_PREVIEW_ENTER_EVENT, onEnter as EventListener);
            window.removeEventListener(MARKER_PREVIEW_LEAVE_EVENT, onLeave as EventListener);
            clearAllPreviewHides();
            map.off('move', syncPosition);
            map.off('zoom', syncPosition);
            map.off('talos:regionSwitched', clearPreviews);
        };
    }, [clearAllPreviewHides, clearPreviewHide, clearPreviews, map, previewEnabled, removePreview, showPreviewFromImages, updateMarkerPosition]);

    const PreviewElement = previewEnabled ? (
        <>
            {previewMarkers.map((item) => {
                const pointName = tGame(`markerType.key.${item.marker.type}`);
                const previewAlt = typeof pointName === 'string' && pointName.trim()
                    ? pointName
                    : item.marker.type;

                return (
                    <PopoverTooltip
                        key={item.marker.id}
                        content={item.previewUrl ? (
                            <div className={styles.previewContent}>
                                <img
                                    src={item.previewUrl}
                                    alt={previewAlt}
                                    className={styles.previewImage}
                                />
                            </div>
                        ) : null}
                        placement="top"
                        gap={14}
                        visible={Boolean(item.previewUrl)}
                        variant="image"
                    >
                        <span
                            className={styles.previewAnchor}
                            style={{ left: item.left, top: item.top }}
                            aria-hidden="true"
                        />
                    </PopoverTooltip>
                );
            })}
        </>
    ) : null;

    return { PreviewElement };
};

export default function RecordToolPreview({ map }: { map: TalosMap | null }) {
    const { PreviewElement } = UseRecordToolPreview(map);
    return <>{PreviewElement}</>;
}

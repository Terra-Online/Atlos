import type { ReactNode } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { IMarkerData } from '@/data/marker';
import { useTranslateGame } from '@/locale';
import { getAppViewport } from '@/component/scale/pip';
import PopoverTooltip from '@/component/popover/popover';
import { useAppViewport } from '@/platform/device';
import { parseTimestamp } from '@/lib/format/time';
import { isRecordToolEnabled } from '@/devtools/loadDevTool';
import {
    peekUGCImages,
    peekPublicUGCImages,
    listPublicUGCImagesByMarkerIds,
    type UGCImage,
} from '@/services/ugc/client';
import {
    MARKER_PREVIEW_ENTER_EVENT,
    MARKER_PREVIEW_LEAVE_EVENT,
    type PreviewEnterDetail,
    type PreviewLeaveDetail,
} from './PreviewEvents';
import styles from './Preview.module.scss';

const RecordToolPreview = import.meta.env.DEV
    ? lazy(() => import('@/devtools/recordTool/RecordToolPreview'))
    : null;

type HoveredMarkerState = {
    marker: IMarkerData;
    left: number;
    top: number;
    previewUrl: string | null;
};

interface UsePreviewResult {
    PreviewElement: ReactNode;
}

const PREVIEW_HIDE_DELAY_MS = 160;
const PREVIEW_FETCH_DELAY_MS = 80;
const PREVIEW_BATCH_SIZE = 10;

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

const UseProductionPreview = (
    map: L.Map | null,
    disabled = false,
): UsePreviewResult => {
    const tGame = useTranslateGame();
    const viewport = useAppViewport();
    const hideTimeoutRef = useRef<number | undefined>(undefined);
    const fetchTimeoutRef = useRef<number | undefined>(undefined);
    const requestTokenRef = useRef(0);
    const hoveredMarkerRef = useRef<IMarkerData | null>(null);
    const recentHoverMarkerIdsRef = useRef<string[]>([]);
    const isPreviewVisibleRef = useRef(false);
    const [hoveredMarker, setHoveredMarker] = useState<HoveredMarkerState | null>(null);
    const [isPreviewVisible, setIsPreviewVisible] = useState(false);
    const previewEnabled = !disabled && !viewport.isPipUiTooSmall;

    const clearHover = useCallback(() => {
        if (fetchTimeoutRef.current) {
            window.clearTimeout(fetchTimeoutRef.current);
            fetchTimeoutRef.current = undefined;
        }
        hoveredMarkerRef.current = null;
        isPreviewVisibleRef.current = false;
        setIsPreviewVisible(false);
        setHoveredMarker(null);
    }, []);

    const scheduleHide = useCallback((markerId?: string) => {
        if (hideTimeoutRef.current) {
            window.clearTimeout(hideTimeoutRef.current);
        }
        if (fetchTimeoutRef.current) {
            window.clearTimeout(fetchTimeoutRef.current);
            fetchTimeoutRef.current = undefined;
        }
        isPreviewVisibleRef.current = false;
        setIsPreviewVisible(false);
        hideTimeoutRef.current = window.setTimeout(() => {
            if (!markerId || hoveredMarkerRef.current?.id === markerId) {
                clearHover();
            }
        }, PREVIEW_HIDE_DELAY_MS);
    }, [clearHover]);

    const cancelHide = useCallback(() => {
        if (hideTimeoutRef.current) {
            window.clearTimeout(hideTimeoutRef.current);
            hideTimeoutRef.current = undefined;
        }
    }, []);

    useEffect(() => {
        if (disabled || viewport.isPipUiTooSmall) clearHover();
    }, [clearHover, disabled, viewport.isPipUiTooSmall]);

    const updateMarkerPosition = useCallback((marker: IMarkerData) => {
        if (!map) return null;
        const point = map.latLngToContainerPoint(marker.pos);
        const rect = map.getContainer().getBoundingClientRect();
        return {
            left: rect.left + point.x,
            top: rect.top + point.y,
        };
    }, [map]);

    const showPreviewFromImages = useCallback((marker: IMarkerData, requestToken: number, images: UGCImage[]) => {
        if (requestTokenRef.current !== requestToken) return;
        if (hoveredMarkerRef.current?.id !== marker.id) return;
        const activeImage = selectPreviewImage(images);
        if (!activeImage) {
            clearHover();
            return;
        }
        const previewUrl = activeImage.url;
        const preloadImage = new Image();
        preloadImage.onload = () => {
            if (requestTokenRef.current !== requestToken) return;
            if (hoveredMarkerRef.current?.id !== marker.id) return;
            if (!isPreviewVisibleRef.current) return;
            const settledPosition = updateMarkerPosition(marker);
            if (!settledPosition) return;
            setHoveredMarker({
                marker,
                left: settledPosition.left,
                top: settledPosition.top,
                previewUrl,
            });
        };
        preloadImage.onerror = () => {
            if (requestTokenRef.current !== requestToken) return;
            if (hoveredMarkerRef.current?.id === marker.id) {
                clearHover();
            }
        };
        preloadImage.src = previewUrl;
    }, [clearHover, updateMarkerPosition]);

    const rememberHoverMarker = useCallback((markerId: string) => {
        const recentIds = recentHoverMarkerIdsRef.current.filter((id) => id !== markerId);
        recentHoverMarkerIdsRef.current = [markerId, ...recentIds].slice(0, PREVIEW_BATCH_SIZE);
    }, []);

    useEffect(() => {
        if (!map || disabled) return;

        const onEnter = (event: Event) => {
            if (!previewEnabled || getAppViewport().isPipUiTooSmall) {
                clearHover();
                return;
            }
            const detail = (event as CustomEvent<PreviewEnterDetail>).detail;
            const marker = detail?.marker;
            if (!marker) return;

            cancelHide();
            rememberHoverMarker(marker.id);
            hoveredMarkerRef.current = marker;
            isPreviewVisibleRef.current = true;
            setIsPreviewVisible(true);
            const requestToken = requestTokenRef.current + 1;
            requestTokenRef.current = requestToken;

            const position = updateMarkerPosition(marker);
            if (!position) return;

            setHoveredMarker({
                marker,
                left: position.left,
                top: position.top,
                previewUrl: null,
            });

            const cachedImages = peekPublicUGCImages(marker.id) ?? peekUGCImages(marker.id);
            if (cachedImages) {
                showPreviewFromImages(marker, requestToken, cachedImages);
                return;
            }

            if (fetchTimeoutRef.current) {
                window.clearTimeout(fetchTimeoutRef.current);
            }
            fetchTimeoutRef.current = window.setTimeout(() => {
                fetchTimeoutRef.current = undefined;
                if (requestTokenRef.current !== requestToken) return;
                if (hoveredMarkerRef.current?.id !== marker.id) return;
                const markerIds = [
                    marker.id,
                    ...recentHoverMarkerIdsRef.current.filter((id) => id !== marker.id),
                ].slice(0, PREVIEW_BATCH_SIZE);

                void listPublicUGCImagesByMarkerIds(markerIds)
                    .then((groupedImages) => {
                        if (requestTokenRef.current !== requestToken) return;
                        if (hoveredMarkerRef.current?.id !== marker.id) return;
                        showPreviewFromImages(marker, requestToken, groupedImages[marker.id] ?? []);
                    })
                    .catch(() => {
                        if (requestTokenRef.current !== requestToken) return;
                        if (hoveredMarkerRef.current?.id === marker.id) {
                            clearHover();
                        }
                    });
            }, PREVIEW_FETCH_DELAY_MS);
        };

        const onLeave = (event: Event) => {
            const detail = (event as CustomEvent<PreviewLeaveDetail>).detail;
            scheduleHide(detail?.markerId);
        };

        const syncPosition = () => {
            const marker = hoveredMarkerRef.current;
            if (!marker) return;
            const position = updateMarkerPosition(marker);
            if (!position) return;
            setHoveredMarker((current) => {
                if (!current || current.marker.id !== marker.id) return current;
                return {
                    ...current,
                    left: position.left,
                    top: position.top,
                };
            });
        };

        const onRegionSwitch = () => {
            cancelHide();
            recentHoverMarkerIdsRef.current = [];
            clearHover();
        };

        window.addEventListener(MARKER_PREVIEW_ENTER_EVENT, onEnter as EventListener);
        window.addEventListener(MARKER_PREVIEW_LEAVE_EVENT, onLeave as EventListener);
        map.on('move', syncPosition);
        map.on('zoom', syncPosition);
        map.on('talos:regionSwitched', onRegionSwitch);

        return () => {
            if (fetchTimeoutRef.current) {
                window.clearTimeout(fetchTimeoutRef.current);
            }
            window.removeEventListener(MARKER_PREVIEW_ENTER_EVENT, onEnter as EventListener);
            window.removeEventListener(MARKER_PREVIEW_LEAVE_EVENT, onLeave as EventListener);
            map.off('move', syncPosition);
            map.off('zoom', syncPosition);
            map.off('talos:regionSwitched', onRegionSwitch);
        };
    }, [cancelHide, clearHover, disabled, map, previewEnabled, rememberHoverMarker, scheduleHide, showPreviewFromImages, updateMarkerPosition]);

    useEffect(() => {
        return () => {
            if (hideTimeoutRef.current) {
                window.clearTimeout(hideTimeoutRef.current);
            }
            if (fetchTimeoutRef.current) {
                window.clearTimeout(fetchTimeoutRef.current);
            }
        };
    }, []);

    const previewAlt = useMemo(() => {
        if (!hoveredMarker) return '';
        const pointName = tGame(`markerType.key.${hoveredMarker.marker.type}`);
        return typeof pointName === 'string' && pointName.trim()
            ? pointName
            : hoveredMarker.marker.type;
    }, [hoveredMarker, tGame]);

    const PreviewElement = previewEnabled && hoveredMarker ? (
        <PopoverTooltip
            key={`${hoveredMarker.marker.id}:${Math.round(hoveredMarker.left)}:${Math.round(hoveredMarker.top)}`}
            content={
                hoveredMarker.previewUrl ? (
                    <div className={styles.previewContent}>
                        <img
                            src={hoveredMarker.previewUrl}
                            alt={previewAlt}
                            className={styles.previewImage}
                        />
                    </div>
                ) : null
            }
            placement="top"
            gap={14}
            visible={isPreviewVisible && Boolean(hoveredMarker.previewUrl)}
            variant="image"
        >
            <span
                className={styles.previewAnchor}
                style={{
                    left: hoveredMarker.left,
                    top: hoveredMarker.top,
                }}
                aria-hidden="true"
            />
        </PopoverTooltip>
    ) : null;

    return { PreviewElement };
};

export const UsePreview = (map: L.Map | null): UsePreviewResult => {
    const recordToolEnabled = isRecordToolEnabled();
    const productionPreview = UseProductionPreview(map, recordToolEnabled);
    const recordToolPreview = recordToolEnabled && RecordToolPreview ? (
        <Suspense fallback={null}>
            <RecordToolPreview map={map} />
        </Suspense>
    ) : null;

    return {
        PreviewElement: recordToolEnabled ? recordToolPreview : productionPreview.PreviewElement,
    };
};

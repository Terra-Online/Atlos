import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { IMarkerData } from '@/data/marker';
import { useTranslateGame } from '@/locale';
import PopoverTooltip from '@/component/popover/popover';
import {
    getUGCImageTransformedUrl,
    listUGCImages,
} from '@/utils/ugcClient';
import {
    MARKER_PREVIEW_ENTER_EVENT,
    MARKER_PREVIEW_LEAVE_EVENT,
    type PreviewEnterDetail,
    type PreviewLeaveDetail,
} from './PreviewEvents';
import styles from './Preview.module.scss';

type HoveredMarkerState = {
    marker: IMarkerData;
    left: number;
    top: number;
    previewUrl: string | null;
};

interface UsePreviewResult {
    PreviewElement: ReactNode;
}

const PREVIEW_WIDTH = 200;
const PREVIEW_HIDE_DELAY_MS = 160;

export const UsePreview = (
    map: L.Map | null,
): UsePreviewResult => {
    const tGame = useTranslateGame();
    const hideTimeoutRef = useRef<number | undefined>(undefined);
    const requestTokenRef = useRef(0);
    const hoveredMarkerRef = useRef<IMarkerData | null>(null);
    const isPreviewVisibleRef = useRef(false);
    const [hoveredMarker, setHoveredMarker] = useState<HoveredMarkerState | null>(null);
    const [isPreviewVisible, setIsPreviewVisible] = useState(false);

    const clearHover = useCallback(() => {
        hoveredMarkerRef.current = null;
        isPreviewVisibleRef.current = false;
        setIsPreviewVisible(false);
        setHoveredMarker(null);
    }, []);

    const scheduleHide = useCallback((markerId?: string) => {
        if (hideTimeoutRef.current) {
            window.clearTimeout(hideTimeoutRef.current);
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

    const updateMarkerPosition = useCallback((marker: IMarkerData) => {
        if (!map) return null;
        const point = map.latLngToContainerPoint(marker.pos);
        const rect = map.getContainer().getBoundingClientRect();
        return {
            left: rect.left + point.x,
            top: rect.top + point.y,
        };
    }, [map]);

    useEffect(() => {
        if (!map) return;

        const onEnter = (event: Event) => {
            const detail = (event as CustomEvent<PreviewEnterDetail>).detail;
            const marker = detail?.marker;
            if (!marker) return;

            cancelHide();
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

            void listUGCImages(marker.id)
                .then((images) => {
                    if (requestTokenRef.current !== requestToken) return;
                    if (hoveredMarkerRef.current?.id !== marker.id) return;
                    const activeImage = images[0];
                    if (!activeImage) {
                        clearHover();
                        return;
                    }
                    const previewUrl = getUGCImageTransformedUrl(activeImage.url, {
                        width: PREVIEW_WIDTH,
                    });
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
                })
                .catch(() => {
                    if (requestTokenRef.current !== requestToken) return;
                    if (hoveredMarkerRef.current?.id === marker.id) {
                        clearHover();
                    }
                });
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
            clearHover();
        };

        window.addEventListener(MARKER_PREVIEW_ENTER_EVENT, onEnter as EventListener);
        window.addEventListener(MARKER_PREVIEW_LEAVE_EVENT, onLeave as EventListener);
        map.on('move', syncPosition);
        map.on('zoom', syncPosition);
        map.on('talos:regionSwitched', onRegionSwitch);

        return () => {
            window.removeEventListener(MARKER_PREVIEW_ENTER_EVENT, onEnter as EventListener);
            window.removeEventListener(MARKER_PREVIEW_LEAVE_EVENT, onLeave as EventListener);
            map.off('move', syncPosition);
            map.off('zoom', syncPosition);
            map.off('talos:regionSwitched', onRegionSwitch);
        };
    }, [cancelHide, clearHover, map, scheduleHide, updateMarkerPosition]);

    useEffect(() => {
        return () => {
            if (hideTimeoutRef.current) {
                window.clearTimeout(hideTimeoutRef.current);
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

    const PreviewElement = hoveredMarker ? (
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

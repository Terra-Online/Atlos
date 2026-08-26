import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import {
    TalosMap,
    CompatLayerGroup,
    CompatImageOverlay,
    CompatRectangle,
    LatLngBounds,
    layerGroup,
    imageOverlay,
    rectangle,
    latLng,
    latLngBounds,
} from '@/component/mapCore/engine';
import type { MapLink, GlobalLinkConfig } from '@/data/map/link';
import { mapRegionKeyToLinkCode } from '@/data/map/link';
import { useLinkStore } from '@/store/link';
import { useTranslateUI } from '@/locale';
import styles from './Links.module.scss';

// Import link images - these need to be imported for Vite to process them
import linkVl0 from '@/assets/images/UI/links/link_vl_0.webp';
import linkVl1 from '@/assets/images/UI/links/link_vl_1.webp';
import linkWl0 from '@/assets/images/UI/links/link_wl_0.webp';
import RightIcon from '@/assets/images/UI/links/T2P.svg?react';
import LeftIcon from '@/assets/images/UI/links/enka.svg?react';

// Map link IDs to their image URLs
const LINK_IMAGES: Record<string, string> = {
    'VL/link_0': linkVl0,
    'VL/link_1': linkVl1,
    'VL/link_2': linkVl1,
    'VL/link_3': linkVl1,
    'WL/link_0': linkWl0,
    'WL/link_1': linkVl1,
    'WL/link_2': linkVl1,
    'WL/link_3': linkVl1,
};

// Delay before hiding tooltip (allows user to move mouse to tooltip)
const TOOLTIP_HIDE_DELAY = 200;

const ensurePane = (map: TalosMap): string => {
    const paneName = 'links';
    const existing = map.getPane(paneName);
    if (existing) return paneName;
    const pane = map.createPane(paneName);
    // Keep links under markers so they don't visually/interaction-block POI markers.
    // Leaflet defaults: overlayPane 400, markerPane 600, tooltipPane 650.
    pane.style.zIndex = '450';
    pane.style.pointerEvents = 'auto';
    return paneName;
};

interface HoveredLinkInfo {
    linkId: string;
    bounds: LatLngBounds;
}

interface UseLinkResult {
    linkTooltipElement: React.ReactNode;
}

/**
 * Hook for rendering link areas on the map
 * Uses imageOverlay for smooth zoom scaling (like tile layers)
 * Returns a tooltip component that uses the native Popover API
 */
export const useLink = (
    map: TalosMap | null,
    mapRegionKey: string | null | undefined,
    maxZoom: number | null | undefined
): UseLinkResult => {
    const tUI = useTranslateUI();
    const regionCode = useMemo(() => mapRegionKeyToLinkCode(mapRegionKey), [mapRegionKey]);

    const linkMap = useLinkStore(
        useMemo(
            () =>
                (state): Record<string, MapLink> | undefined => {
                    if (!regionCode) return undefined;
                    return state.current.regions[regionCode]?.links;
                },
            [regionCode]
        )
    );

    const globalConfig = useLinkStore(
        (state): GlobalLinkConfig => state.current.config
    );

    const links: MapLink[] = useMemo(() => (linkMap ? Object.values(linkMap) : []), [linkMap]);

    const layerRef = useRef<CompatLayerGroup | null>(null);
    const paneRef = useRef<string | null>(null);
    const overlaysRef = useRef<Map<string, CompatImageOverlay>>(new Map());
    const hitAreasRef = useRef<Map<string, CompatRectangle>>(new Map());

    const hoveredLinkRef = useRef<HoveredLinkInfo | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const hideTimeoutRef = useRef<number | undefined>(undefined);

    // Position and show the popover
    const showPopover = useCallback((bounds: LatLngBounds) => {
        if (!map || !popoverRef.current) return;

        // Clear any pending hide
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
            hideTimeoutRef.current = undefined;
        }

        const popover = popoverRef.current as HTMLElement & { showPopover?: () => void };
        const topCenter = latLng(bounds.getNorth(), bounds.getCenter().lng);
        const point = map.latLngToContainerPoint(topCenter);

        // Get map container position for absolute positioning within document
        const mapContainer = map.getContainer();
        const mapRect = mapContainer.getBoundingClientRect();

        popover.style.position = 'fixed';
        popover.style.left = `${mapRect.left + point.x}px`;
        popover.style.top = `${mapRect.top + point.y - 12}px`;
        popover.style.transform = 'translate(-50%, -100%)';

        popover.classList.remove(styles.popoverClose);
        if (popover.showPopover) {
            try {
                popover.showPopover();
            } catch (_e) {
                // Ignore if already shown
            }
        }
    }, [map]);

    // Hide the popover with animation (with delay to allow moving to tooltip)
    const hidePopover = useCallback(() => {
        // Use delay to allow user to move mouse to tooltip
        hideTimeoutRef.current = window.setTimeout(() => {
            if (!popoverRef.current) return;

            const popover = popoverRef.current as HTMLElement & { hidePopover?: () => void };
            popover.classList.add(styles.popoverClose);

            // Additional timeout for fade-out animation
            window.setTimeout(() => {
                if (popover.hidePopover) {
                    try {
                        popover.hidePopover();
                    } catch (_e) {
                        // Ignore if already hidden
                    }
                }
                popover.classList.remove(styles.popoverClose);
            }, 150);
        }, TOOLTIP_HIDE_DELAY);
    }, []);

    // Cancel hide when mouse enters tooltip
    const cancelHide = useCallback(() => {
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
            hideTimeoutRef.current = undefined;
        }
    }, []);

    // Render links on the map using imageOverlay for smooth scaling
    const renderLinks = useCallback(() => {
        if (!map || !regionCode || typeof maxZoom !== 'number') return;
        
        // Ensure pane exists
        if (!paneRef.current) {
            paneRef.current = ensurePane(map);
        }

        // Ensure layer exists and is added to map
        if (!layerRef.current) {
            layerRef.current = layerGroup([], { pane: paneRef.current });
        }
        
        if (!map.hasLayer(layerRef.current)) {
            layerRef.current.addTo(map);
        }

        const layer = layerRef.current;

        // Clear existing layers
        layer.clearLayers();
        overlaysRef.current.clear();
        hitAreasRef.current.clear();

        // Don't render if no links
        if (links.length === 0) return;

        // Track which links we're adding to avoid duplicates
        const processedLinkIds = new Set<string>();

        for (const link of links) {
            // Skip if this link has already been processed (prevent duplicates)
            if (processedLinkIds.has(link.id)) continue;
            processedLinkIds.add(link.id);

            const [[x1, y1], [x2, y2]] = link.bounds;

            // Convert pixel coordinates to lat/lng
            const southWest = map.unproject([Math.min(x1, x2), Math.max(y1, y2)], maxZoom);
            const northEast = map.unproject([Math.max(x1, x2), Math.min(y1, y2)], maxZoom);
            const bounds = latLngBounds(southWest, northEast);

            const pane = paneRef.current;
            const imageUrl = LINK_IMAGES[link.id];

            if (imageUrl) {
                // Create image overlay - this scales smoothly with map zoom like tiles
                const linkOverlay = imageOverlay(imageUrl, bounds, {
                    pane,
                    interactive: false, // Hit detection handled by rectangle below
                    className: 'link-image-overlay',
                });
                layer.addLayer(linkOverlay);
                overlaysRef.current.set(link.id, linkOverlay);
            }

            // Create invisible rectangle for hit detection
            const hitArea = rectangle(bounds, {
                pane,
                interactive: true,
                // 引擎支持 stroke:false 与 pointer-events:all——透明热区照常接收 hover
                stroke: false,
                fill: true,
                fillOpacity: 0,
                // Use unique className with link ID to prevent duplicate paths
                className: `link-hit-area link-hit-area-${link.id.replace(/\//g, '-')}`,
            });

            hitArea.on('mouseover', () => {
                hoveredLinkRef.current = { linkId: link.id, bounds };
                showPopover(bounds);
            });

            hitArea.on('mouseout', () => {
                hoveredLinkRef.current = null;
                hidePopover();
            });

            layer.addLayer(hitArea);
            hitAreasRef.current.set(link.id, hitArea);
        }
    }, [map, regionCode, maxZoom, links, showPopover, hidePopover]);

    // Setup event listeners for popover position and region switch
    useEffect(() => {
        if (!map) return;

        // Update popover position on map move
        const updatePopoverPosition = () => {
            const current = hoveredLinkRef.current;
            if (!current) return;
            showPopover(current.bounds);
        };

        // Clear state on region switch (re-render handled by dependency on regionCode/links)
        const onRegionSwitch = () => {
            hoveredLinkRef.current = null;
            hidePopover();
        };

        map.on('move', updatePopoverPosition);
        map.on('zoom', updatePopoverPosition);
        map.on('talos:regionSwitched', onRegionSwitch);

        return () => {
            map.off('move', updatePopoverPosition);
            map.off('zoom', updatePopoverPosition);
            map.off('talos:regionSwitched', onRegionSwitch);
        };
    }, [map, showPopover, hidePopover]);

    // Render links when all dependencies are ready
    useEffect(() => {
        if (!map || !regionCode || typeof maxZoom !== 'number') return;
        renderLinks();
    }, [map, regionCode, maxZoom, links, renderLinks]);

    // Cleanup when map is destroyed
    useEffect(() => {
        if (!map) return;
        const layer = layerRef.current;
        const overlays = overlaysRef.current;
        const hitAreas = hitAreasRef.current;
        const hideTimeout = hideTimeoutRef.current;
        return () => {
            if (layer) {
                layer.remove();
            }
            overlays.clear();
            hitAreas.clear();
            if (hideTimeout) {
                clearTimeout(hideTimeout);
            }
        };
    }, [map]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }
        };
    }, []);

    // Build the tooltip element
    // Helper to safely extract string from translation result
    const getTranslatedString = (key: string): string => {
        const result = tUI(key);
        if (result === null || result === undefined) return '';
        if (typeof result === 'string') return result;
        // If result is an object (nested i18n structure), return the key as fallback
        return key;
    };

    const leftTitle = globalConfig?.leftLink?.titleKey
        ? getTranslatedString(globalConfig.leftLink.titleKey)
        : '';
    const rightTitle = globalConfig?.rightLink?.titleKey
        ? getTranslatedString(globalConfig.rightLink.titleKey)
        : '';

    const handleLinkClick = (url: string | undefined) => {
        if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    };

    const linkTooltipElement = (
        <div
            ref={popoverRef}
            popover="manual"
            className={styles.linkTooltipPopover}
            onMouseEnter={cancelHide}
            onMouseLeave={hidePopover}
        >
            <div className={styles.tooltipContainer}>
                {globalConfig?.leftLink?.url && (
                    <button
                        className={styles.linkTooltip}
                        onClick={() => handleLinkClick(globalConfig.leftLink.url)}
                    >
                        <span className={styles.tooltipIcon}><LeftIcon /></span>
                        <span className={styles.tooltipText}>{leftTitle}</span>
                        <span className={styles.tooltipArrow}>↗</span>
                    </button>
                )}
                {globalConfig?.rightLink?.url && (
                    <button
                        className={styles.linkTooltip}
                        onClick={() => handleLinkClick(globalConfig.rightLink.url)}
                    >
                        <span className={styles.tooltipIcon}><RightIcon /></span>
                        <span className={styles.tooltipText}>{rightTitle}</span>
                        <span className={styles.tooltipArrow}>↗</span>
                    </button>
                )}
            </div>
        </div>
    );

    return { linkTooltipElement };
};

import { useState, useEffect, useRef, StrictMode, type CSSProperties } from 'react';
import ErrorBoundary from '@/component/shared/ErrorBoundary';
import { useRetryImport } from '@/lib/dom/useRetryImport';
import L from 'leaflet';


import Map from '@/pages/map/Map';
import UIOverlay from '@/pages/uiOverlay/UIOverlay';
import SideBar from '@/pages/sideBar/sideBar';
import DomainBanner from '@/pages/domain/domain';
import LocatorBanner from '@/pages/locator/LocatorBanner';
// Critical locator recovery UI: keep it in the entry bundle so policy errors cannot be blocked by a missing chunk.
import LocationAuth from '@/pages/locator/LocationAuth';
import EndfieldBindingHost from '@/pages/locator/EndfieldBindingHost';
// import SupportAutoPopup from '@/component/shared/support/SupportAutoPopup';
import { MetaHelper } from '@/pages/MetaHelper';

import { useSidebarOpen, useSidebarWidth } from '@/store/uiPrefs';
import { useDevice } from '@/platform/device';
import { useKeyboardShortcuts } from '@/pages/settings/useShortcuts';
import { useMapMultiSelect } from '@/services/map/selection/useMapMultiSelect';
import { useLocator } from '@/pages/map/useLocator';
import { useIsUserGuideOpen } from '@/store/uiPrefs';
import { useLocatorStore } from '@/store/locator';
import { useUIVisibility } from '@/pages/uiOverlay/useUIVisibility';

const loadUserGuide = () => import('@/pages/userGuide/UserGuide');

declare global {
    interface Window {
        __TALOS_DEV__?: {
            map?: L.Map;
            mapCore?: unknown;
        };
    }
}

function MapPage() {
    // Use persisted sidebar open state as the single source of truth
    const isSidebarOpen = useSidebarOpen();
    const sidebarWidth = useSidebarWidth();
    const { isDesktop } = useDevice();
    const [mapInstance, setMapInstance] = useState<L.Map | undefined>(
        undefined,
    );
    const {
        shortcutDocument,
        showVisibilityControl,
        showUI,
        uiVisible,
        toggleUI,
    } = useUIVisibility();
    const [shouldLoadUserGuide, setShouldLoadUserGuide] = useState(false);
    const UserGuide = useRetryImport(loadUserGuide, shouldLoadUserGuide)?.default;
    const [userGuideReady, setUserGuideReady] = useState(false);
    const isUserGuideOpen = useIsUserGuideOpen();
    const locatorAuthOpen = useLocatorStore((state) => state.authOpen);

    // Keyboard shortcuts & map multi-select
    useKeyboardShortcuts(mapInstance, shortcutDocument, { showUI });
    useMapMultiSelect(mapInstance);
    useLocator(mapInstance);

    useEffect(() => {
        // Safari gestures can start on floating UI and body-level portals, not
        // only on Leaflet. Capture them before child handlers can hand a
        // multi-touch sequence back to the browser.
        const preventBrowserZoom = (event: Event) => event.preventDefault();
        const preventMultiTouchBrowserZoom = (event: TouchEvent) => {
            if (event.touches.length > 1) event.preventDefault();
        };
        const listenerOptions: AddEventListenerOptions = {
            capture: true,
            passive: false,
        };

        document.addEventListener(
            'gesturestart',
            preventBrowserZoom,
            listenerOptions,
        );
        document.addEventListener(
            'gesturechange',
            preventBrowserZoom,
            listenerOptions,
        );
        document.addEventListener(
            'touchmove',
            preventMultiTouchBrowserZoom,
            listenerOptions,
        );

        return () => {
            document.removeEventListener(
                'gesturestart',
                preventBrowserZoom,
                listenerOptions,
            );
            document.removeEventListener(
                'gesturechange',
                preventBrowserZoom,
                listenerOptions,
            );
            document.removeEventListener(
                'touchmove',
                preventMultiTouchBrowserZoom,
                listenerOptions,
            );
        };
    }, []);

    useEffect(() => {
        if (shouldLoadUserGuide) return;
        if (isUserGuideOpen) {
            setShouldLoadUserGuide(true);
            return;
        }

        const id = globalThis.setTimeout(() => setShouldLoadUserGuide(true), 0);
        return () => globalThis.clearTimeout(id);
    }, [isUserGuideOpen, shouldLoadUserGuide]);

    // Track previous sidebar state to detect actual toggles
    const prevSidebarOpenRef = useRef(isSidebarOpen);

    // Desktop: pan map when sidebar toggles to keep visible center stable
    useEffect(() => {
        if (!mapInstance || !isDesktop) return;
        const prevOpen = prevSidebarOpenRef.current;
        prevSidebarOpenRef.current = isSidebarOpen;
        if (prevOpen === isSidebarOpen) return; // no actual toggle

        // Only pan when zoomed in beyond 1.5; at wide views it's unnecessary
        const currentZoom = mapInstance.getZoom();
        if (currentZoom <= 1.5) return;

        const opening = isSidebarOpen;
        const dx = opening ? -sidebarWidth / 2 : sidebarWidth / 2;

        // Temporarily remove maxBounds so the pan is not clipped.
        // Passing invalid bounds to setMaxBounds removes the constraint and
        // de-registers the internal _panInsideMaxBounds handler.
        let savedBounds = mapInstance.options.maxBounds as L.LatLngBounds | undefined;
        if (savedBounds) {
            mapInstance.setMaxBounds(null as unknown as L.LatLngBoundsExpression);
        }

        const restoreBounds = () => {
            mapInstance.off('moveend talos:regionSwitchStart', restoreBounds);
            const bounds = savedBounds;
            savedBounds = undefined;
            if (bounds) mapInstance.setMaxBounds(bounds);
        };
        mapInstance.on('moveend talos:regionSwitchStart', restoreBounds);
        mapInstance.panBy([dx, 0], { animate: true, duration: 0.3, easeLinearity: 0.25 });
        return restoreBounds;
    }, [isSidebarOpen, sidebarWidth, mapInstance, isDesktop]);

    // onToggle is retained for potential side effects/analytics
    const handleSidebarToggle = (_isOpen: boolean) => {
        // no-op: components read from store directly
    };

    const handleMapReady = (map: L.Map) => {
        setMapInstance(map);

        if (import.meta.env.DEV) {
            window.__TALOS_DEV__ = window.__TALOS_DEV__ ?? {};
            window.__TALOS_DEV__.map = map;
        }
    };

    return (
        <StrictMode>
            <MetaHelper />
            {uiVisible && (
                <>
                    <DomainBanner />
                    <LocatorBanner />
                    {locatorAuthOpen && (
                        <LocationAuth />
                    )}
                    <EndfieldBindingHost />
                </>
            )}
            {/*<SupportAutoPopup />*/}
            <div className='app theme-transition-scope' style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
                {UserGuide && (
                    <ErrorBoundary>
                        <UserGuide
                            map={mapInstance}
                            visible={uiVisible}
                            onReady={() => setUserGuideReady(true)}
                        />
                    </ErrorBoundary>
                )}
                {/* Map layer - always fill the entire window */}
                <ErrorBoundary>
                    <Map onMapReady={handleMapReady} />
                </ErrorBoundary>
                {/* UI layer - floats over the map */}
                <UIOverlay
                    map={mapInstance}
                    isSidebarOpen={isSidebarOpen}
                    visible={uiVisible}
                    showVisibilityControl={showVisibilityControl}
                    onToggleUI={toggleUI}
                    userGuideReady={userGuideReady}
                />
                {/* Sidebar layer - floats over the map */}
                <SideBar
                    // map={mapInstance}
                    currentRegion={null}
                    onToggle={handleSidebarToggle}
                    visible={uiVisible}
                />
            </div>
        </StrictMode>
    );
}

export default MapPage;

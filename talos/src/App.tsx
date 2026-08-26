import { lazy, Suspense, useState, useEffect, useRef, StrictMode, type CSSProperties } from 'react';
import type { LatLngBounds, TalosMap } from '@/component/mapCore/engine';

import './styles/global.scss';

import Map from './component/map/Map';
import UIOverlay from './component/uiOverlay/UIOverlay';
import SideBar from './component/sideBar/sideBar';
import DomainBanner from './component/domain/domain';
import LocatorBanner from '@/component/locator/LocatorBanner';
// Critical locator recovery UI: keep it in the entry bundle so policy errors cannot be blocked by a missing chunk.
import LocationAuth from '@/component/locator/LocationAuth';
import EndfieldBindingHost from '@/component/locator/EndfieldBindingHost';
// import SupportAutoPopup from '@/component/support/SupportAutoPopup';
import { MetaHelper } from './component/MetaHelper';

import { useSidebarOpen, useSidebarWidth } from '@/store/uiPrefs';
import { useDevice } from '@/utils/device';
import { useKeyboardShortcuts } from '@/component/settings/useShortcuts';
import { useMapMultiSelect } from '@/component/settings/useMapMultiSelect';
import { useLocator } from '@/component/map/useLocator';
import { useIsUserGuideOpen } from '@/store/uiPrefs';
import { useLocatorStore } from '@/component/locator/state';
import { useUIVisibility } from '@/component/uiOverlay/useUIVisibility';

const UserGuide = lazy(() => import('@/component/userGuide/UserGuide'));

declare global {
    interface Window {
        __TALOS_DEV__?: {
            map?: TalosMap;
            mapCore?: unknown;
        };
    }
}

function App() {
    // Use persisted sidebar open state as the single source of truth
    const isSidebarOpen = useSidebarOpen();
    const sidebarWidth = useSidebarWidth();
    const { isDesktop } = useDevice();
    const [mapInstance, setMapInstance] = useState<TalosMap | undefined>(
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
    const [userGuideReady, setUserGuideReady] = useState(false);
    const isUserGuideOpen = useIsUserGuideOpen();
    const locatorAuthOpen = useLocatorStore((state) => state.authOpen);

    // Keyboard shortcuts & map multi-select
    useKeyboardShortcuts(mapInstance, shortcutDocument, { showUI });
    useMapMultiSelect(mapInstance);
    useLocator(mapInstance);

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
        // Passing null to setMaxBounds removes the constraint and
        // de-registers the internal _panInsideMaxBounds handler.
        const savedBounds = mapInstance.options.maxBounds as LatLngBounds | undefined;
        if (savedBounds) {
            mapInstance.setMaxBounds(null);
        }

        mapInstance.panBy([dx, 0], { animate: true, duration: 0.3 });

        if (savedBounds) {
            mapInstance.once('moveend', () => {
                mapInstance.setMaxBounds(savedBounds);
            });
        }
    }, [isSidebarOpen, sidebarWidth, mapInstance, isDesktop]);

    // onToggle is retained for potential side effects/analytics
    const handleSidebarToggle = (_isOpen: boolean) => {
        // no-op: components read from store directly
    };

    const handleMapReady = (map: TalosMap) => {
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
                {shouldLoadUserGuide && (
                    <Suspense fallback={null}>
                        <UserGuide
                            map={mapInstance}
                            visible={uiVisible}
                            onReady={() => setUserGuideReady(true)}
                        />
                    </Suspense>
                )}
                {/* Map layer - always fill the entire window */}
                <Map onMapReady={handleMapReady} />
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

export default App;

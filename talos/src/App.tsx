import { useState, useEffect, useRef, StrictMode, type CSSProperties } from 'react';
import L from 'leaflet';

import './styles/global.scss';

import Map from './component/map/Map';
import UIOverlay from './component/uiOverlay/UIOverlay';
import SideBar from './component/sideBar/sideBar';
import UserGuide from '@/component/userGuide/UserGuide';
import DomainBanner from './component/domain/domain';
// import SupportAutoPopup from '@/component/support/SupportAutoPopup';
import { MetaHelper } from './component/MetaHelper';

import { useSidebarOpen, useSidebarWidth } from '@/store/uiPrefs';
import { useDevice } from '@/utils/device';
import { useKeyboardShortcuts } from '@/component/settings/useShortcuts';
import { useMapMultiSelect } from '@/component/settings/useMapMultiSelect';
import { useEndfieldMapTracker } from '@/component/map/useEndfieldMapTracker';

declare global {
    interface Window {
        __TALOS_DEV__?: {
            map?: L.Map;
            mapCore?: unknown;
        };
    }
}

function App() {
    // Use persisted sidebar open state as the single source of truth
    const isSidebarOpen = useSidebarOpen();
    const sidebarWidth = useSidebarWidth();
    const { isDesktop } = useDevice();
    const [mapInstance, setMapInstance] = useState<L.Map | undefined>(
        undefined,
    );
    const [uiVisible, setUiVisible] = useState(true);

    // Keyboard shortcuts & map multi-select
    useKeyboardShortcuts(mapInstance);
    useMapMultiSelect(mapInstance);
    useEndfieldMapTracker(mapInstance);

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
        const savedBounds = mapInstance.options.maxBounds as L.LatLngBounds | undefined;
        if (savedBounds) {
            mapInstance.setMaxBounds(null as unknown as L.LatLngBoundsExpression);
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

    const handleMapReady = (map: L.Map) => {
        setMapInstance(map);

        if (import.meta.env.DEV) {
            window.__TALOS_DEV__ = window.__TALOS_DEV__ ?? {};
            window.__TALOS_DEV__.map = map;
        }
    };

    const handleHideUI = () => {
        setUiVisible(false);
    };

    // Show UI on any click or page visibility change
    useEffect(() => {
        const showUI = () => {
            setUiVisible(true);
        };

        const handleClick = (e: MouseEvent) => {
            if (!uiVisible) {
                e.stopPropagation();
                showUI();
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                showUI();
            }
        };

        if (!uiVisible) {
            // Use capture phase to catch clicks before they reach other elements
            document.addEventListener('click', handleClick, true);
            document.addEventListener(
                'visibilitychange',
                handleVisibilityChange,
            );
        }

        return () => {
            document.removeEventListener('click', handleClick, true);
            document.removeEventListener(
                'visibilitychange',
                handleVisibilityChange,
            );
        };
    }, [uiVisible]);

    return (
        <StrictMode>
            <MetaHelper />
            <DomainBanner />
            {/*<SupportAutoPopup />*/}
            <div className='app theme-transition-scope' style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
                <UserGuide map={mapInstance} />
                {/* Map layer - always fill the entire window */}
                <Map onMapReady={handleMapReady} />
                {/* UI layer - floats over the map */}
                <UIOverlay
                    map={mapInstance}
                    isSidebarOpen={isSidebarOpen}
                    visible={uiVisible}
                    onHideUI={handleHideUI}
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

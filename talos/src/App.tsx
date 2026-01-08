import { useState, useEffect, StrictMode } from 'react';
import './styles/global.scss';

import Map from './component/map/Map';
import UIOverlay from './component/uiOverlay/UIOverlay';
import SideBar from './component/sideBar/sideBar';
import L from 'leaflet';
import { useSidebarOpen } from '@/store/uiPrefs';
import UserGuide from '@/component/userGuide/UserGuide.tsx';
import { MetaHelper } from './component/MetaHelper';

declare global {
    interface Window {
        __TALOS_DEV__?: {
            map?: L.Map;
        };
    }
}

function App() {
    // Use persisted sidebar open state as the single source of truth
    const isSidebarOpen = useSidebarOpen();
    const [mapInstance, setMapInstance] = useState<L.Map | undefined>(
        undefined,
    );
    const [uiVisible, setUiVisible] = useState(true);

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
            <div className='app theme-transition-scope'>
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

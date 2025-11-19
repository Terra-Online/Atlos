import { useState, useEffect, StrictMode } from 'react';
import './styles/global.scss';

import Map from './component/map/Map';
import UIOverlay from './component/uiOverlay/UIOverlay';
import SideBar from './component/sideBar/sideBar';
import L from 'leaflet';
import { useSidebarOpen } from '@/store/uiPrefs';
import Joyride from 'react-joyride';
import { userGuideSteps } from '@/component/userGuide/UserGuide.tsx';
import { MinimalTooltip } from '@/component/userGuide/tooltip/UserGuideTooltip.tsx';

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

    // TODO: Remove this before merge
    document.documentElement.setAttribute('data-theme', 'dark')
    return (
        <StrictMode>
            <Joyride
                steps={userGuideSteps}
                run={true}
                continuous={true}
                debug={true}
                tooltipComponent={MinimalTooltip}
                styles={{
                    options: {
                        arrowColor: 'rgba(0,0,0,0)',
                        zIndex: 10000,
                    },
                }}
            />
            <div className='app theme-transition-scope'>
                <div className={'text'}>text</div>
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

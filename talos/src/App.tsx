import { useState } from 'react';
import './styles/global.scss';

import Map from './component/map/Map';
import UIOverlay from './component/uiOverlay/UIOverlay';
import SideBar from './component/sideBar/sideBar';
import L from 'leaflet';
import { useSidebarOpen } from '@/store/uiPrefs';

function App() {
    // Use persisted sidebar open state as the single source of truth
    const isSidebarOpen = useSidebarOpen();
    const [mapInstance, setMapInstance] = useState<L.Map | undefined>(
        undefined,
    );

    // onToggle is retained for potential side effects/analytics
    const handleSidebarToggle = (_isOpen: boolean) => {
        // no-op: components read from store directly
    };

    const handleMapReady = (map: L.Map) => {
        setMapInstance(map);
    };

    return (
        <div className='app theme-transition-scope'>
            {/* Map layer - always fill the entire window */}
            <Map onMapReady={handleMapReady} />
            {/* UI layer - floats over the map */}
            <UIOverlay map={mapInstance} isSidebarOpen={isSidebarOpen} />
            {/* Sidebar layer - floats over the map */}
            <SideBar
                // map={mapInstance}
                currentRegion={null}
                onToggle={handleSidebarToggle}
            />
        </div>
    );
}

export default App;
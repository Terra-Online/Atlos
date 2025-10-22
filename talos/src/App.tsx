import { useState } from 'react';
import './styles/global.scss';

import Map from './component/map/Map';
import UIOverlay from './component/uiOverlay/UIOverlay';
import SideBar from './component/sideBar/sideBar';
import L from 'leaflet';

function App() {
    //broadcasting sideBar status
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [mapInstance, setMapInstance] = useState<L.Map | undefined>(
        undefined,
    );

    const handleSidebarToggle = (isOpen: boolean) => {
        setIsSidebarOpen(isOpen);
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

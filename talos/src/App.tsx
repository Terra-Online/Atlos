import { useState } from 'react';
import './styles/global.scss';

import Map from './component/map/Map';
import UIOverlay from './component/uiOverlay/UIOverlay';
import SideBar from './component/sideBar/sideBar';

function App() {
  //broadcasting sideBar status
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mapInstance, setMapInstance] = useState<L.Map | undefined>(undefined);

  const handleSidebarToggle = (isOpen: boolean) => {
    setIsSidebarOpen(isOpen);
  };

  const handleMapReady = (map: L.Map) => {
    setMapInstance(map);
  };

  return (
    <div className="app">
      <Map onMapReady={handleMapReady} />
      <UIOverlay map={mapInstance} isSidebarOpen={isSidebarOpen} />
      <SideBar
        map={mapInstance}
        currentRegion={null}
        onToggle={handleSidebarToggle}
      />
    </div>
  );
}

export default App;

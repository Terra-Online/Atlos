import React, { useState } from 'react';
import './styles/global.scss';

import MapContainer from './component/mapContainer/mapContainer';
import SideBar from './component/sideBar/sideBar';
import SimpleSelect from './component/toolkit/SimpleSelect';

function App() {
  //broadcasting sideBar status, no Zustand for temp
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const handleSidebarToggle = (isOpen) => {
    setIsSidebarOpen(isOpen);
  };
  return (
    <div className="app">
      <MapContainer isSidebarOpen={isSidebarOpen} />
      <SideBar onToggle={handleSidebarToggle} />
      <SimpleSelect />
    </div>
  );
}
export default App;
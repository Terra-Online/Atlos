import React, { useState } from 'react';
import './styles/global.scss';

import Map from './component/mapContainer/mapContainer';
import SideBar from './component/sideBar/sideBar';

function App() {
  const [mapInstance, setMapInstance] = useState(null);
  return (
    <div className="App">
      <Map setMapInstance={setMapInstance}/>
      <SideBar map={mapInstance} />
    </div>
  );
}

export default App;

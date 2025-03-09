import React, { useState, useEffect } from 'react';
import './sideBar.scss';
import L from 'leaflet';

import Icon from '../../asset/images/observator_6.webp';
import SidebarIcon from '../../asset/logos/sideCollap.svg?react';

import Search from '../search/search';
import FavPOI from '../favPOI/favPOI';
import MarkFilter from '../markFilter/markFilter';

const SideBar = ({ map, onToggle }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [markers, setMarkers] = useState([]);
  const [selectedMarker, setSelectedMarker] = useState(null);

  const toggleSidebar = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    if (onToggle) {
      onToggle(newState);
    }
  };

  return (
    <div className={`sidebar-container ${isOpen ? 'open' : ''}`}>
      <button
        className={`sidebar-toggle ${isOpen ? 'open' : ''}`}
        onClick={toggleSidebar}
      >
        <SidebarIcon />
      </button>

      <div className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="head_icon">
          <img src={Icon} alt='supported by observator 6' />
        </div>
        <div className="sidebar-content">
          <Search />
          <div className='filters'>
            <MarkFilter title='Collection' />
            <MarkFilter title='Resource' />
            <MarkFilter title='Enermy Spawner' />
            <MarkFilter title='Boss Fight' />
            <MarkFilter title='Missions' />
            <MarkFilter title='POI' />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SideBar;
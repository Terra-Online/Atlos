import React, { useState, useEffect } from 'react';
import './sideBar.scss';
import L from 'leaflet';

import Icon from '../../asset/images/observator_6.webp';

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
        {isOpen ? (
          <svg viewBox="0 0 24 24">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24">
            <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" />
          </svg>
        )}
      </button>

      <div className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="head_icon">
          <img src={Icon} alt='supported by observator 6'/>
        </div>
        <div className="sidebar-content">
          <Search />
          <div className='filters'>
            <MarkFilter title='Collection'/>
            <MarkFilter title='Resource'/>
            <MarkFilter title='Enermy Spawner'/>
            <MarkFilter title='Boss Fight'/>
            <MarkFilter title='Missions'/>
            <MarkFilter title='POI'/>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SideBar;
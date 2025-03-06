import React, { useState, useEffect } from 'react';
import './sideBar.scss';
import L from 'leaflet';

import Icon from '../../asset/images/observator_6.webp';

import Search from '../search/search';
import FavPOI from '../favPOI/favPOI';
import MarkFilter from '../markFilter/markFilter';

const SideBar = ({ map }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [markers, setMarkers] = useState([]);
  const [selectedMarker, setSelectedMarker] = useState(null);

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };


  return (
    <div className="sidebar-container">
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
          <MarkFilter title='Collection'/>
            <h2>Map Information</h2>
            <p>Map Name: Valley 4</p>
            <p>Map Size: 8000 x 10000</p>
            <p>Map Scale: 1:1</p>
            <p>Map Type: Topographic</p>
        </div>
      </div>
    </div>
  );
};

export default SideBar;
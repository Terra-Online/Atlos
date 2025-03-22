import React, { useState, useEffect, useMemo } from 'react';
import './sideBar.scss';
import L from 'leaflet';

import Icon from '../../asset/images/observator_6.webp';
import SidebarIcon from '../../asset/logos/sideCollap.svg?react';

import Search from '../search/search';
import FavPOI from '../favPOI/favPOI';
import MarkFilter from '../markFilter/markFilter';
import Mark from '../mark/mark';

import pointsData from '../../data/main.json';
import typesData from '../../data/types.json';

const SideBar = ({ map, currentRegion, onToggle }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState({
    resource: [],
    enemy: [],
    poi: [],
    facility: []
  });
  const [points, setPoints] = useState(pointsData.points || []);

  // Get region filter
  const regionFilter = useMemo(() => {
    if (!currentRegion) return null;
    return {
      main: currentRegion.main,
      sub: currentRegion.sub
    };
  }, [currentRegion]);

  // Mark select
  const handleMarkFilter = (category, typeInfo) => {
    setActiveFilters(prev => {
      const typeKey = `${typeInfo.main}-${typeInfo.sub}-${typeInfo.key}`;

      const isActive = prev[category].some(filter =>
        `${filter.main}-${filter.sub}-${filter.key}` === typeKey
      );
      return {
        ...prev,
        [category]: isActive
          ? prev[category].filter(filter =>
              `${filter.main}-${filter.sub}-${filter.key}` !== typeKey
            )
          : [...prev[category], typeInfo]
      };
    });
    if (map) {
      // Update map markers
    }
  };

  const isFilterActive = (category, typeInfo) => {
    return activeFilters[category]?.some(filter =>
      filter.main === typeInfo.main &&
      filter.sub === typeInfo.sub &&
      filter.key === typeInfo.key
    ) || false;
  };

  // Types by category
  const typesByCategory = useMemo(() => {
    // initialize pre-result
    const result = {
      resource: [],
      enemy: [],
      poi: [],
      facility: []
    };
    const processedTypes = new Set();

    points.forEach(point => {
      const { main, sub, key } = point.type;
      if (!main || !result[main]) return;

      const typeId = `${main}-${sub}-${key}`;
      // add to result if not processed
      if (!processedTypes.has(typeId)) {
        processedTypes.add(typeId);
        result[main].push({ main, sub, key });
      }
    });
    return result;
  }, [points]);

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
            <MarkFilter title='Resource'>
              {typesByCategory.resource.map((typeInfo, index) => (
                <Mark
                  key={`resource-${typeInfo.sub}-${typeInfo.key}-${index}`}
                  points={points}
                  typeInfo={typeInfo}
                  regionFilter={regionFilter}
                  onFilterClick={(info) => handleMarkFilter('resource', info)}
                  isFilterActive={isFilterActive('resource', typeInfo)}
                />
              ))}
              {typesByCategory.resource.length === 0 && (
                <div className="mark-empty">No points available. Contact your Endministrator for support.</div>
              )}
            </MarkFilter>

            <MarkFilter title='Enemies'>
              {typesByCategory.enemy.map((typeInfo, index) => (
                <Mark
                  key={`enemy-${typeInfo.sub}-${typeInfo.key}-${index}`}
                  points={points}
                  typeInfo={typeInfo}
                  regionFilter={regionFilter}
                  onFilterClick={(info) => handleMarkFilter('enemy', info)}
                  isFilterActive={isFilterActive('enemy', typeInfo)}
                />
              ))}
              {typesByCategory.enemy.length === 0 && (
                <div className="mark-empty">No points available. Contact your Endministrator for support.</div>
              )}
            </MarkFilter>

            <MarkFilter title='POI'>
              {typesByCategory.poi.map((typeInfo, index) => (
                <Mark
                  key={`poi-${typeInfo.sub}-${typeInfo.key}-${index}`}
                  points={points}
                  typeInfo={typeInfo}
                  regionFilter={regionFilter}
                  onFilterClick={(info) => handleMarkFilter('poi', info)}
                  isFilterActive={isFilterActive('poi', typeInfo)}
                />
              ))}
              {typesByCategory.poi.length === 0 && (
                <div className="mark-empty">No points available. Contact your Endministrator for support.</div>
              )}
            </MarkFilter>

            <MarkFilter title='Facilities'>
              {typesByCategory.facility.map((typeInfo, index) => (
                <Mark
                  key={`facility-${typeInfo.sub}-${typeInfo.key}-${index}`}
                  points={points}
                  typeInfo={typeInfo}
                  regionFilter={regionFilter}
                  onFilterClick={(info) => handleMarkFilter('facility', info)}
                  isFilterActive={isFilterActive('facility', typeInfo)}
                />
              ))}
              {typesByCategory.facility.length === 0 && (
                <div className="mark-empty">No points available. Contact your Endministrator for support.</div>
              )}
            </MarkFilter>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SideBar;
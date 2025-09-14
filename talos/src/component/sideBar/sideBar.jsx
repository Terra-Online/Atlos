import React, {useState, useMemo} from 'react';
import styles from './sideBar.module.scss';

import Icon from '../../asset/images/UI/observator_6.webp';
import SidebarIcon from '../../asset/logos/sideCollap.svg?react';

import Search from '../search/search';
import FavPOI from '../favPOI/favPOI';
import MarkFilter from '../markFilter/markFilter';
import Mark from '../mark/mark';

import {MARKER_TYPE_TREE} from '../../data/marker';

console.log(MARKER_TYPE_TREE)

const SideBar = ({map, currentRegion, onToggle}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState({
    resource: [],
    enemy: [],
    poi: [],
    facility: []
  });

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

  const toggleSidebar = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    if (onToggle) {
      onToggle(newState);
    }
  };

  return (
    <div className={`${styles['sidebar-container']} ${isOpen ? styles.open : ''}`}>
      <button
        className={`${styles['sidebar-toggle']} ${isOpen ? styles.open : ''}`}
        onClick={toggleSidebar}
      >
        <SidebarIcon/>
      </button>

      <div className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
        <div className={styles.head_icon}>
          <img src={Icon} alt='supported by observator 6' draggable={"false"}/>
        </div>
        <div className={styles['sidebar-content']}>
          <Search/>
          <div className={styles.filters}>
            {Object.entries(MARKER_TYPE_TREE).map(([key, value]) => (
              <MarkFilter title={key} key={key}>{
                Object.values(value).flat().map((typeInfo, index) => (
                  <Mark
                    key={typeInfo.key}
                    typeInfo={typeInfo}
                  />
                ))
              }</MarkFilter>
            ))}
          </div>
        </div>
        <div className={styles.copyright}>
          <a href="https://beian.miit.gov.cn/">沪ICP备<b>2025119702</b>号-1</a>
        </div>
      </div>
    </div>
  );
};

export default SideBar;
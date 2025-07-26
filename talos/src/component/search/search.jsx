import React, { useCallback, useState } from 'react';
import SearchIcon from '../../asset/logos/search.svg?react';
import styles from './search.module.scss';
import { useMarkerStore } from '../mapContainer/store/marker';

const Search = () => {
  const {searchString, setSearchString} = useMarkerStore()
  const changeHandler = useCallback((e) => {
    setSearchString(e.target.value)
  }, [])

  return (
    <div className={styles['search-container']}>
      <form className={styles['search-form']}>
        <div className={styles['search-input-wrapper']}>
          <div className={styles['search-icon']}>
            <SearchIcon className={styles.icon} />
          </div>
          <input
            type="text"
            className={styles['search-input']}
            placeholder="Overall search..."
            value={searchString}
            onChange={changeHandler}
          />
        </div>
      </form>
    </div>
  );
};

export default Search;
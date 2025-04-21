import React, { useCallback, useState } from 'react';
import SearchIcon from '../../asset/logos/search.svg?react';
import './search.scss';
import { useMarkerStore } from '../mapContainer/store/marker';

const Search = () => {
  const {searchString, setSearchString} = useMarkerStore()
  const changeHandler = useCallback((e) => {
    setSearchString(e.target.value)
  }, [])

  return (
    <div className="search-container">
      <form className="search-form">
        <div className="search-input-wrapper">
          <div className="search-icon">
            <SearchIcon className="icon" />
          </div>
          <input
            type="text"
            className="search-input"
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
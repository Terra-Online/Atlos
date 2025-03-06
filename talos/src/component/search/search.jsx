import React, { useState } from 'react';
import { ReactComponent as SearchIcon } from '../../asset/logos/search.svg';
import './search.scss';

const Search = () => {
  const [searchText, setSearchText] = useState('');

  const handleChange = (e) => {
    setSearchText(e.target.value);
  };

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
            value={searchText}
            onChange={handleChange}
          />
        </div>
      </form>
    </div>
  );
};

export default Search;
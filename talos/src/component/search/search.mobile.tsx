import React, { useCallback } from 'react';
import SearchIcon from '../../assets/logos/search.svg?react';
import styles from './search.module.scss';
import { useTranslateUI } from '@/locale';
import { useMarkerStore } from '@/store/marker.ts';

interface SearchMobileProps {
  width?: number | string; // allow parent to control width flexibly
}

const SearchMobile: React.FC<SearchMobileProps> = ({ width = '100%' }) => {
  const { searchString, setSearchString } = useMarkerStore();
  const t = useTranslateUI();
  const changeHandler = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchString(e.target.value);
  }, [setSearchString]);

  return (
    <div className={styles.searchContainer} style={{ width }}>
      <form className={styles.searchForm}>
        <div className={styles.searchInputWrapper}>
          <div className={styles.searchIcon}>
            <SearchIcon className={styles.icon} />
          </div>
          <input
            type='text'
            className={styles.searchInput}
            placeholder={t('search.placeholder')}
            value={searchString}
            onChange={changeHandler}
          />
        </div>
      </form>
    </div>
  );
};

export default SearchMobile;

import React, { useCallback } from 'react';
import SearchIcon from '../../assets/logos/search.svg?react';
import styles from './search.module.scss';
import { useTranslateUI } from '@/locale';
import { useMarkerStore } from '@/store/marker.ts';

const Search = () => {
    const { searchString, setSearchString } = useMarkerStore();
    const t = useTranslateUI();
    const changeHandler = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            setSearchString(e.target.value);
        },
        [],
    );

    return (
        <div className={styles.searchContainer}>
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

export default Search;

import type { FC } from 'react';
import SearchIcon from '../../assets/logos/search.svg?react';
import { useLocale, useTranslateUI } from '@/locale';
import { formatIcuText } from '@/locale/messageFormat';
import styles from './search.module.scss';

export interface ExternalSearchProps {
    value: string;
    resultCount: number;
    placeholder: string;
    onChange: (value: string) => void;
}

const SearchInput: FC<
    ExternalSearchProps & { mobile?: boolean; width?: number | string }
> = ({
    value,
    resultCount,
    placeholder,
    onChange,
    mobile = false,
    width = '100%',
}) => {
    const hasQuery = value.trim().length > 0;
    const locale = useLocale();
    const t = useTranslateUI();
    const resultsText = formatIcuText({
        template: t('search.results'),
        locale,
        values: { count: resultCount },
    });
    return (
        <div
            className={`${styles.searchContainer} ${mobile ? styles.mobile : ''}`}
            style={{ width }}
        >
            <form
                className={styles.searchForm}
                onSubmit={(event) => event.preventDefault()}
            >
                <div className={styles.searchInputWrapper}>
                    <div
                        className={styles.searchInputRow}
                        data-has-count={hasQuery ? 'true' : 'false'}
                    >
                        <div className={styles.searchIcon}>
                            <SearchIcon className={styles.icon} />
                        </div>
                        <input
                            type='text'
                            data-search-input='true'
                            className={styles.searchInput}
                            placeholder={placeholder}
                            value={value}
                            onChange={(event) => onChange(event.target.value)}
                        />
                        {hasQuery && (
                            <span className={styles.searchResultCountInline}>
                                {resultsText}
                            </span>
                        )}
                    </div>
                </div>
            </form>
        </div>
    );
};

export default SearchInput;

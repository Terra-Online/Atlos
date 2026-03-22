import React, { useCallback, useMemo } from 'react';
import SearchIcon from '../../assets/logos/search.svg?react';
import Valley4 from '../../assets/logos/_Valley_4.svg?react';
import Wuling from '../../assets/logos/_Wuling.svg?react';
import Dijiang from '../../assets/logos/_Dijiang.svg?react';
import styles from './search.module.scss';
import PopoverTooltip from '@/component/popover/popover';
import { useLocale, useTranslateUI } from '@/locale';
import { getItemIconUrl } from '@/utils/resource';
import { navigateToSharedPoint } from '@/utils/navigation';
import { trackedSwitchFilter } from '@/store/trackedActions';
import { useMarkerStore } from '@/store/marker.ts';
import { useAdvancedSearch } from './useAdvancedSearch';

interface SearchSharedProps {
    width?: number | string;
}

const REGION_ICON_DICT: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
    Valley_4: Valley4,
    Wuling,
    Dijiang,
};

const HighlightText = ({ text, keyword }: { text: string; keyword: string }) => {
    if (!keyword) return <>{text}</>;

    const lowerText = text.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    const idx = lowerText.indexOf(lowerKeyword);
    if (idx < 0) return <>{text}</>;

    const before = text.slice(0, idx);
    const hit = text.slice(idx, idx + keyword.length);
    const after = text.slice(idx + keyword.length);

    return (
        <>
            {before}
            <span className={styles.matchHighlight}>{hit}</span>
            {after}
        </>
    );
};

const SearchShared: React.FC<SearchSharedProps> = ({ width = '100%' }) => {
    const { searchString, setSearchString } = useMarkerStore();
    const locale = useLocale();
    const t = useTranslateUI();
    const { results, loading, normalizedQuery } = useAdvancedSearch(searchString, locale);

    const changeHandler = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchString(e.target.value);
    }, [setSearchString]);

    const hasResults = results.length > 0;

    const clickableResults = useMemo(() => results.map((group) => {
        const canNavigate = !!group.uniquePoint;
        return {
            ...group,
            canNavigate,
            clickTitle: canNavigate ? (String(t('search.locatePoint')) || 'Locate point') : (String(t('search.selectType')) || 'Select type'),
        };
    }), [results, t]);

    const onResultClick = useCallback((group: (typeof clickableResults)[number]) => {
        if (group.uniquePoint) {
            navigateToSharedPoint({
                regionKey: group.uniquePoint.regionKey,
                subregionKey: group.uniquePoint.subregionId,
                pointId: group.uniquePoint.pointId,
            });
            return;
        }
        trackedSwitchFilter(group.typeKey);
    }, []);

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

            {hasResults && (
                <div className={styles.searchResultPanel} data-loading={loading ? 'true' : 'false'}>
                    {clickableResults.map((group) => {
                        const iconUrl = getItemIconUrl(group.iconKey, 'webp');
                        const showFileSnippet = group.typeMain === 'files';
                        const titleMatched = group.displayName.toLowerCase().includes(normalizedQuery);
                        const keyMatched = group.typeKey.toLowerCase().includes(normalizedQuery);
                        const regionTip = group.subregionNames.join('/');

                        return (
                            <button
                                type='button'
                                key={group.typeKey}
                                className={styles.searchResultItem}
                                onClick={() => onResultClick(group)}
                                title={group.clickTitle}
                            >
                                <span className={styles.resultIcon}>
                                    <img src={iconUrl} alt={group.displayName} draggable={false} />
                                </span>
                                <span className={styles.resultMain}>
                                    <span className={styles.resultTitle}>
                                        {titleMatched || keyMatched ? (
                                            <HighlightText text={group.displayName} keyword={normalizedQuery} />
                                        ) : (
                                            group.displayName
                                        )}
                                    </span>
                                    <span className={styles.resultSub} data-kind={showFileSnippet ? 'snippet' : 'count'}>
                                        {showFileSnippet ? (
                                            group.snippet ? <HighlightText text={group.snippet} keyword={normalizedQuery} /> : group.displayName
                                        ) : (
                                            `${group.worldTotal}/${group.mainTotal}/${group.subTotal}`
                                        )}
                                    </span>
                                </span>
                                <span className={styles.resultRegions}>
                                    {group.regions.map((regionKey) => {
                                        const Icon = REGION_ICON_DICT[regionKey];
                                        if (!Icon) return null;
                                        return (
                                            <PopoverTooltip key={`${group.typeKey}-${regionKey}`} content={regionTip} placement='top' disabled={!regionTip}>
                                                <span className={styles.regionIconBox}>
                                                    <Icon />
                                                </span>
                                            </PopoverTooltip>
                                        );
                                    })}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default SearchShared;

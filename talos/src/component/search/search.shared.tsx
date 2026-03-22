import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LinearBlur } from 'progressive-blur';
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
    const activeFilters = useMarkerStore((s) => s.filter);
    const locale = useLocale();
    const t = useTranslateUI();
    const { results, loading, normalizedQuery } = useAdvancedSearch(searchString, locale);

    const changeHandler = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchString(e.target.value);
    }, [setSearchString]);

    const hasQuery = normalizedQuery.length > 0;
    const panelOpen = hasQuery;
    const resultPanelRef = useRef<HTMLDivElement | null>(null);
    const [maskTopVisible, setMaskTopVisible] = useState(false);
    const [maskBottomVisible, setMaskBottomVisible] = useState(false);

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
            if (!activeFilters.includes(group.typeKey)) {
                trackedSwitchFilter(group.typeKey);
            }
            navigateToSharedPoint({
                regionKey: group.uniquePoint.regionKey,
                subregionKey: group.uniquePoint.subregionId,
                pointId: group.uniquePoint.pointId,
            });
            return;
        }
        trackedSwitchFilter(group.typeKey);
    }, [activeFilters]);

    const updateMaskVisibility = useCallback(() => {
        const panel = resultPanelRef.current;
        if (!panel || !panelOpen) {
            setMaskTopVisible(false);
            setMaskBottomVisible(false);
            return;
        }

        const overflow = panel.scrollHeight - panel.clientHeight > 2;
        const atTop = panel.scrollTop <= 1;
        const atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2;

        // Match mobile sidebar behavior: only show blur when scrollable and away from that edge.
        setMaskTopVisible(overflow && !atTop);
        setMaskBottomVisible(overflow && !atBottom);
    }, [panelOpen]);

    useEffect(() => {
        if (!panelOpen) {
            setMaskTopVisible(false);
            setMaskBottomVisible(false);
            return;
        }

        const rafId = window.requestAnimationFrame(() => {
            updateMaskVisibility();
        });

        const onResize = () => updateMaskVisibility();
        window.addEventListener('resize', onResize);

        return () => {
            window.cancelAnimationFrame(rafId);
            window.removeEventListener('resize', onResize);
        };
    }, [panelOpen, results.length, updateMaskVisibility]);

    const resultsText = useMemo(() => {
        const templateRaw = t('search.results');
        const template = typeof templateRaw === 'string' && templateRaw.trim() ? templateRaw : '{count} results';
        return template.replace('{count}', String(results.length));
    }, [results.length, t]);

    return (
        <div className={styles.searchContainer} style={{ width }}>
            <form className={styles.searchForm}>
                <div className={styles.searchInputWrapper} data-expanded={panelOpen ? 'true' : 'false'}>
                    <div className={styles.searchInputRow} data-has-count={hasQuery ? 'true' : 'false'}>
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
                        {hasQuery && (
                            <span className={styles.searchResultCountInline}>{resultsText}</span>
                        )}
                    </div>

                    <>
                        <div className={styles.resultDivider} data-open={panelOpen ? 'true' : 'false'} />
                        <div
                            className={styles.searchResultShell}
                            data-loading={loading ? 'true' : 'false'}
                            data-open={panelOpen ? 'true' : 'false'}
                            data-mask-top={maskTopVisible ? 'true' : 'false'}
                            data-mask-bottom={maskBottomVisible ? 'true' : 'false'}
                        >
                            <LinearBlur
                                side='top'
                                strength={8}
                                falloffPercentage={85}
                                className={`${styles.topBlur} ${maskTopVisible ? styles.visible : ''}`}
                            />
                            <LinearBlur
                                side='bottom'
                                strength={8}
                                falloffPercentage={100}
                                className={`${styles.bottomBlur} ${maskBottomVisible ? styles.visible : ''}`}
                            />
                            <div
                                className={styles.searchResultPanel}
                                ref={resultPanelRef}
                                onScroll={updateMaskVisibility}
                            >
                                {clickableResults.map((group) => {
                                        const iconUrl = getItemIconUrl(group.iconKey, 'webp');
                                        const showFileSnippet = group.typeMain === 'files';
                                        const titleMatched = group.displayName.toLowerCase().includes(normalizedQuery);
                                        const keyMatched = group.typeKey.toLowerCase().includes(normalizedQuery);

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
                                                            <span className={styles.resultCount}>
                                                                <span className={styles.resultCountNumber}>{group.worldTotal}</span>
                                                                <span className={styles.resultCountSep}>/</span>
                                                                <span className={styles.resultCountNumber}>{group.mainTotal}</span>
                                                                <span className={styles.resultCountSep}>/</span>
                                                                <span className={styles.resultCountNumber}>{group.subTotal}</span>
                                                            </span>
                                                        )}
                                                    </span>
                                                </span>
                                                <span className={styles.resultRegions}>
                                                    {group.regions.map((regionKey) => {
                                                        const Icon = REGION_ICON_DICT[regionKey];
                                                        if (!Icon) return null;
                                                        const regionNames = group.subregionNamesByRegion[regionKey];
                                                        const safeRegionNames = Array.isArray(regionNames) ? regionNames : [];
                                                        const prefixKey = safeRegionNames.length > 1 ? 'search.distributeAt' : 'search.locatedAt';
                                                        const prefixRaw = t(prefixKey);
                                                        const prefix = typeof prefixRaw === 'string' && prefixRaw.trim()
                                                            ? prefixRaw
                                                            : (safeRegionNames.length > 1 ? 'Distributed at' : 'Located at');
                                                        const separator = /[A-Za-z0-9]$/.test(prefix) ? ' ' : '';
                                                        const regionNamesJoined = safeRegionNames.join('/');
                                                        const regionTip = safeRegionNames.length > 0
                                                            ? (
                                                                <span className={styles.popoverText}>
                                                                    <span className={styles.popoverPrefix}>{prefix}{separator}</span>
                                                                    <span>{regionNamesJoined}</span>
                                                                </span>
                                                            )
                                                            : '';
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
                        </div>
                    </>
                </div>
            </form>
        </div>
    );
};

export default SearchShared;

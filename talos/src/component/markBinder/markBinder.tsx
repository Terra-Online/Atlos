import { useMemo, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import styles from './markBinder.module.scss';
import type { BinderGroup } from '@/data/marker/binder';
import { getItemIconUrl } from '@/utils/resource';
import { useTranslateGame } from '@/locale';
import { useMultiRegionMarkerCount, useFilter, useSearchString, useMarkerStore } from '@/store/marker';
import MarkSelector from '../markSelector/markSelector';
import { trackedSetFilterKeys } from '@/store/trackedActions';
import { MarkVisibilityContext } from '../markFilter/visibilityContext';

interface MarkBinderProps {
    group: BinderGroup;
}

type StyleVars = CSSProperties & {
    '--progress-percentage'?: string;
};

const MarkBinder = ({ group }: MarkBinderProps) => {
    const tGame = useTranslateGame();
    const filter = useFilter();
    const searchString = useSearchString();
    const normalizedSearch = useMemo(() => searchString.toLowerCase(), [searchString]);

    const iconUrl = useMemo(
        () => group.sharedKey === 'rsch'
            ? '/assets/images/item/investigate.webp'
            : getItemIconUrl(group.dropKey, 'webp'),
        [group.dropKey, group.sharedKey],
    );

    const titleKey = `${group.titleKeyPrefix ?? 'markerType.drop'}.${group.dropKey}`;
    const translatedTitle = tGame(titleKey) as string | undefined;
    const displayName =
        typeof translatedTitle === 'string' && translatedTitle.trim().length > 0
            ? translatedTitle
            : group.dropName;

    const typeKeys = useMemo(() => group.types.map((t) => t.key), [group.types]);
    const counts = useMultiRegionMarkerCount(typeKeys);
    const totalCollected = counts.reduce((a, c) => a + c.collected, 0);
    const totalTotal = counts.reduce((a, c) => a + c.total, 0);
    const binderMatched = Boolean(
        normalizedSearch &&
        (group.dropKey.toLowerCase().includes(normalizedSearch) || displayName.toLowerCase().includes(normalizedSearch)),
    );

    const renderedTypes = useMemo(
        () => group.types.filter((typeInfo, index) => {
            const count = counts[index];
            if (!count || count.total <= 0) return false;
            if (!normalizedSearch || binderMatched) return true;

            const typeDisplayName = String(tGame(`markerType.key.${typeInfo.key}`) ?? '').toLowerCase();
            return typeInfo.key.toLowerCase().includes(normalizedSearch) || typeDisplayName.includes(normalizedSearch);
        }),
        [group.types, counts, normalizedSearch, binderMatched, tGame],
    );

    // Completed selectors float to the top; order is stable within each tier
    const sortedRenderedTypes = useMemo(() => {
        return [...renderedTypes].sort((a, b) => {
            const aIdx = group.types.indexOf(a);
            const bIdx = group.types.indexOf(b);
            const aC = counts[aIdx];
            const bC = counts[bIdx];
            const aComplete = Boolean(aC && aC.total > 0 && aC.collected >= aC.total);
            const bComplete = Boolean(bC && bC.total > 0 && bC.collected >= bC.total);
            if (aComplete === bComplete) return 0;
            return aComplete ? -1 : 1;
        });
    }, [renderedTypes, group.types, counts]);

    // During search we still render a single matching selector instead of collapsing.
    const shouldCollapseChildren = searchString === '' && renderedTypes.length <= 1;

    const showFilter = useMemo(() => {
        if (!totalTotal) return false;
        if (!normalizedSearch) return true;
        return (
            group.dropKey.toLowerCase().includes(normalizedSearch) ||
            displayName.toLowerCase().includes(normalizedSearch) ||
            renderedTypes.length > 0
        );
    }, [totalTotal, normalizedSearch, group.dropKey, displayName, renderedTypes.length]);

    const ctx = useContext(MarkVisibilityContext);
    const idRef = useRef<string>(group.dropKey);
    const [layoutAnimReady, setLayoutAnimReady] = useState(false);

    useEffect(() => {
        let raf1 = 0;
        let raf2 = 0;
        raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => setLayoutAnimReady(true));
        });
        return () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
        };
    }, []);

    useEffect(() => {
        const stableId = idRef.current;
        ctx?.report(stableId, showFilter);
        return () => ctx?.report(stableId, false);
    }, [ctx, showFilter]);

    // Direct computation — no useMemo, always reflects the latest filter in the same render pass
    const allActive = typeKeys.length > 0 && typeKeys.every((k) => filter.includes(k));
    const isComplete = totalTotal > 0 && totalCollected >= totalTotal;

    // Binder selection has highest priority: can both select and deselect all types
    const handleToggleAll = useCallback(() => {
        const currentFilter = useMarkerStore.getState().filter;
        const currentlyAllActive =
            typeKeys.length > 0 && typeKeys.every((k) => currentFilter.includes(k));
        trackedSetFilterKeys(typeKeys, !currentlyAllActive);
    }, [typeKeys]);

    if (!showFilter) return null;

    const progressPct = totalTotal > 0 ? Math.round((totalCollected / totalTotal) * 100) : 0;

    return (
        // All visual effects + click handler on the entire wrap
        <div
            className={`${styles.binderWrap} ${allActive ? styles.active : ''} ${isComplete ? styles.completed : ''}`}
            style={{ '--progress-percentage': `${progressPct}%` } as StyleVars}
            onClick={handleToggleAll}
        >
            {/* Header: layout only, click bubbles up to wrap */}
            <div
                className={styles.binderItem}
                data-binder-keys={typeKeys.join(',')}
            >
                <span className={styles.binderIcon}>
                    <img
                        src={iconUrl}
                        alt={displayName}
                        draggable="false"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                </span>
                <span className={styles.binderName}>{displayName}</span>
                <span className={styles.binderStat}>{totalCollected}/{totalTotal}</span>
            </div>
            {/* Children: stop propagation so child selector clicks don't also trigger wrap */}
            {!shouldCollapseChildren && (
                <div className={styles.binderChildren} onClick={(e) => e.stopPropagation()}>
                    {sortedRenderedTypes.map((typeInfo) => (
                        <motion.div
                            key={typeInfo.key}
                            layout={layoutAnimReady}
                            transition={{ type: 'spring', stiffness: 400, damping: 38 }}
                        >
                            <MarkSelector typeInfo={typeInfo} />
                        </motion.div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MarkBinder;

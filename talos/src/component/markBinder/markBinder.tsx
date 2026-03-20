import { useMemo, useCallback, useContext, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
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

    const iconUrl = useMemo(
        () => getItemIconUrl(group.dropKey, 'webp'),
        [group.dropKey],
    );

    const displayName = String(
        tGame(`markerType.drop.${group.dropKey}`) !== `markerType.drop.${group.dropKey}`
            ? tGame(`markerType.drop.${group.dropKey}`)
            : group.dropName,
    );

    const typeKeys = useMemo(() => group.types.map((t) => t.key), [group.types]);
    const counts = useMultiRegionMarkerCount(typeKeys);
    const totalCollected = counts.reduce((a, c) => a + c.collected, 0);
    const totalTotal = counts.reduce((a, c) => a + c.total, 0);

    const renderedTypes = useMemo(
        () => group.types.filter((typeInfo, index) => {
            const count = counts[index];
            if (!count || count.total <= 0) return false;
            if (searchString === '') return true;

            const typeDisplayName = String(tGame(`markerType.key.${typeInfo.key}`) ?? '');
            return typeInfo.key.includes(searchString) || typeDisplayName.includes(searchString);
        }),
        [group.types, counts, searchString, tGame],
    );

    const is1to1 = renderedTypes.length <= 1;

    const showFilter = useMemo(() => {
        if (!totalTotal) return false;
        if (searchString === '') return true;
        return (
            group.dropKey.includes(searchString) ||
            displayName.toLowerCase().includes(searchString.toLowerCase()) ||
            renderedTypes.length > 0
        );
    }, [totalTotal, searchString, group.dropKey, displayName, renderedTypes.length]);

    const ctx = useContext(MarkVisibilityContext);
    const idRef = useRef<string>(group.dropKey);
    useEffect(() => {
        const stableId = idRef.current;
        ctx?.report(stableId, showFilter);
        return () => ctx?.report(stableId, false);
    }, [ctx, showFilter]);

    // Direct computation — no useMemo, always reflects the latest filter in the same render pass
    const allActive = typeKeys.length > 0 && typeKeys.every((k) => filter.includes(k));
    const isComplete = totalTotal > 0 && totalCollected >= totalTotal;

    // Read allActive from the store imperatively so the callback is never stale
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
            {!is1to1 && (
                <div
                    className={styles.binderChildren}
                    onClick={(e) => e.stopPropagation()}
                >
                    {renderedTypes.map((typeInfo) => (
                        <MarkSelector key={typeInfo.key} typeInfo={typeInfo} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default MarkBinder;

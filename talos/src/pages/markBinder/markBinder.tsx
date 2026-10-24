import { memo, useMemo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import styles from '@/pages/markBinder/markBinder.module.scss';
import type { BinderItem } from '@/pages/sideBar/model';
import { getItemIconUrl } from '@/services/assets/resource';
import { useMarkerStore } from '@/store/marker';
import MarkSelector from '@/pages/markSelector/markSelector';
import { SelectorRows } from '@/pages/sideBar/sidebarWindow';
import { useLayoutVersion } from '@/store/uiPrefs';
import useRegion from '@/store/region';

interface MarkBinderProps {
    item: BinderItem;
    mobile?: boolean;
}

type StyleVars = CSSProperties & {
    '--progress-percentage'?: string;
};

const MarkBinder = ({ item, mobile = false }: MarkBinderProps) => {
    const { group, name: displayName, count: { total: totalTotal, collected: totalCollected }, children: sortedRenderedTypes, collapseChildren: shouldCollapseChildren, visible: showFilter } = item;
    const layoutVersion = useLayoutVersion();
    const currentRegion = useRegion(state => state.currentRegionKey);
    const iconUrl = useMemo(
        () => group.sharedKey === 'rsch'
            ? getItemIconUrl('investigate', 'webp')
            : getItemIconUrl(group.dropKey, 'webp'),
        [group.dropKey, group.sharedKey],
    );

    const typeKeys = useMemo(() => group.types.map(type => type.key), [group.types]);
    const allActive = useMarkerStore(state => typeKeys.length > 0 && typeKeys.every(key => state.filter.includes(key)));
    const [layoutAnimReady, setLayoutAnimReady] = useState(false);
    const layoutVersionRef = useRef(layoutVersion);
    const renderedSignature = sortedRenderedTypes.map(({ typeInfo }) => typeInfo.key).join(',');
    const layoutSignature = `${currentRegion}:${layoutVersion}:${displayName}:${renderedSignature}`;
    const previousLayout = useRef(layoutSignature);
    const [animating, setAnimating] = useState(false);
    const layoutChanged = previousLayout.current !== layoutSignature;
    useLayoutEffect(() => {
        if (previousLayout.current === layoutSignature) return undefined;
        previousLayout.current = layoutSignature;
        setAnimating(true);
        const timer = window.setTimeout(() => setAnimating(false), 1000);
        return () => window.clearTimeout(timer);
    }, [layoutSignature]);

    const armLayoutAnimation = useCallback(() => {
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
        return armLayoutAnimation();
    }, [armLayoutAnimation]);

    // A font commit can change line wrapping after Motion has captured its
    // previous box. Disable child projection for two frames, then measure the
    // settled boxes again. This keeps the normal expand/reorder spring intact.
    useLayoutEffect(() => {
        if (layoutVersionRef.current === layoutVersion) return undefined;
        layoutVersionRef.current = layoutVersion;
        setLayoutAnimReady(false);
        return armLayoutAnimation();
    }, [armLayoutAnimation, layoutVersion]);

    const isComplete = totalTotal > 0 && totalCollected >= totalTotal;

    // Binder selection has highest priority: can both select and deselect all types
    const handleToggleAll = useCallback(() => {
        const currentFilter = useMarkerStore.getState().filter;
        const currentlyAllActive =
            typeKeys.length > 0 && typeKeys.every((k) => currentFilter.includes(k));
        useMarkerStore.getState().setFilterKeys(typeKeys, !currentlyAllActive);
    }, [typeKeys]);

    if (!showFilter) return null;

    const progressPct = totalTotal > 0 ? Math.round((totalCollected / totalTotal) * 100) : 0;

    return (
        // All visual effects + click handler on the entire wrap
        <div
            className={`${styles.binderWrap} ${allActive ? styles.active : ''} ${isComplete ? styles.completed : ''}`}
            style={{ '--progress-percentage': `${progressPct}%` } as StyleVars}
            onClick={handleToggleAll}
            data-binder-wrap="true"
            data-active={allActive ? 'true' : 'false'}
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
                        loading='eager'
                        decoding='async'
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
                <div className={`${styles.binderChildren} ${mobile ? styles.mobileChildren : ''}`} onClick={(e) => e.stopPropagation()}>
                    {<SelectorRows items={sortedRenderedTypes} columns={mobile ? 2 : 1} compact renderItem={(child, index, style) => (
                        <motion.div
                            key={child.typeInfo.key}
                            style={style}
                            data-sidebar-row={style.gridRow ? Number(style.gridRow) - 1 : undefined}
                            data-sidebar-index={index}
                            layout={layoutAnimReady && (layoutChanged || animating)}
                            // Region changes also move retained rows when other binders
                            // disappear or change columns, even if these keys stay the same.
                            layoutDependency={`${currentRegion}:${index}:${layoutVersion}:${displayName}:${renderedSignature}`}
                            transition={{ type: 'spring', stiffness: 400, damping: 38 }}
                        >
                            <MarkSelector item={child} />
                        </motion.div>
                    )} />}
                </div>
            )}
        </div>
    );
};

export default memo(MarkBinder);

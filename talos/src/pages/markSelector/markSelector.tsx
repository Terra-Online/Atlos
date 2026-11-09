import { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import styles from '@/pages/markSelector/markSelector.module.scss';
import { getItemIconUrl } from '@/services/assets/resource';
import type { SelectorItem } from '@/pages/sideBar/model';
import { useMarkerStore } from '@/store/marker';
import { useLayoutVersion } from '@/store/uiPrefs';
import { useAppDocument } from '@/platform/pictureInPicture';
import { measureSelector } from '@/pages/markSelector/measureQueue';

interface MarkSelectorProps {
    item: SelectorItem;
    style?: CSSProperties;
    index?: number;
}

const measuredNames = new WeakMap<Document, Map<string, { truncated: boolean; height?: number }>>();

let zCounter = 80;
const nextZ = () => {
    zCounter = zCounter >= 500 ? 50 : zCounter + 1;
    return zCounter;
};

const MarkSelector = ({ item, style, index }: MarkSelectorProps) => {
    type StyleVars = CSSProperties & {
        '--progress-percentage'?: string;
        '--expanded-height'?: string;
    };
    const ELEVATE_FALLBACK_MS = 500; // equal to the CSS transition duration
    const { typeInfo, count: cnt, name: displayName } = item;

    // icon url: prefer explicit icon field (files dataset uses icon name, not type key)
    const iconUrl = useMemo<string | null>(() => {
        const iconKey = typeInfo?.icon ?? typeInfo?.key;
        return iconKey ? String(getItemIconUrl(iconKey, 'webp')) : null;
    }, [typeInfo?.key, typeInfo?.icon]);

    // stores
    const isActive = useMarkerStore((state) => state.filter.includes(typeInfo.key));
    const handleSwitchFilter = useCallback(
        () => useMarkerStore.getState().switchFilter(typeInfo.key),
        [typeInfo.key],
    );
    // Check if collection is complete (100% progress)
    const isComplete = useMemo(() => {
        return cnt.total > 0 && cnt.collected >= cnt.total;
    }, [cnt.total, cnt.collected]);
    const nameRef = useRef<HTMLSpanElement | null>(null);
    const expandedRef = useRef<HTMLSpanElement | null>(null);
    const [isTruncated, setIsTruncated] = useState(false);
    const [isElevated, setIsElevated] = useState(false);
    const [zIndex, setZIndex] = useState<number>(1);
    const elevateTimer = useRef<number | null>(null);
    const [expandedHeightPx, setExpandedHeightPx] = useState<number | null>(null);
    const layoutVersion = useLayoutVersion();
    const ownerDocument = useAppDocument();

    // Measure admitted names in bounded read/write batches; font commits invalidate the cache.
    useEffect(() => {
        const el = nameRef.current;
        const expandedEl = expandedRef.current;
        if (!el) return;
        return measureSelector(() => {
            if (!el.isConnected) return undefined;
            let cache = measuredNames.get(el.ownerDocument);
            if (!cache) { cache = new Map(); measuredNames.set(el.ownerDocument, cache); }
            const key = `${layoutVersion}:${displayName}:${el.clientWidth}`;
            let result = cache.get(key);
            if (!result) {
                result = { truncated: el.scrollWidth > el.clientWidth, height: expandedEl?.scrollHeight };
                cache.set(key, result);
                if (cache.size > 256) cache.delete(cache.keys().next().value!);
            }
            const { truncated, height } = result;
            return () => {
                setIsTruncated(truncated);
                if (height && Number.isFinite(height)) setExpandedHeightPx(height);
            };
        }, el.ownerDocument.defaultView ?? window, el);
    }, [displayName, layoutVersion, ownerDocument]);

    // clean elevate fallback timer, avoid setState after unmount
    useEffect(() => () => {
        if (elevateTimer.current) {
            window.clearTimeout(elevateTimer.current);
            elevateTimer.current = null;
        }
    }, []);

    if (!item.visible) return null;
    return (
        <div className={styles.markSkeleton} style={style} data-sidebar-index={index} data-sidebar-row={style?.gridRow ? Number(style.gridRow) - 1 : undefined}>
            <div
                className={`${styles.markItem} ${isActive ? styles.active : ''} ${isComplete ? styles.completed : ''}`}
                data-key={typeInfo.key}
                data-mark-selector-item="true"
                data-active={isActive ? 'true' : 'false'}
                data-type={typeInfo.category?.main}
                onClick={handleSwitchFilter}
                style={((): StyleVars => {
                    const styleObj: StyleVars = {
                        '--progress-percentage': `${cnt.total > 0 ? Math.round((cnt.collected / cnt.total) * 100) : 0}%`,
                    };
                    if (expandedHeightPx) {
                        styleObj['--expanded-height'] = `${expandedHeightPx}px`;
                    }
                    if (isElevated) {
                        (styleObj as CSSProperties).zIndex = zIndex;
                    }
                    return styleObj;
                })()}
                data-truncated={isTruncated ? 'true' : 'false'}
                onMouseEnter={() => {
                    setIsElevated(true);
                    setZIndex(nextZ());
                    if (elevateTimer.current) {
                        window.clearTimeout(elevateTimer.current);
                        elevateTimer.current = null;
                    }
                }}
                onMouseLeave={() => {
                    // elevate fallback
                    elevateTimer.current = window.setTimeout(() => {
                        setIsElevated(false);
                        elevateTimer.current = null;
                    }, ELEVATE_FALLBACK_MS);
                }}
                onFocus={() => {
                    setIsElevated(true);
                    setZIndex(nextZ());
                    if (elevateTimer.current) {
                        window.clearTimeout(elevateTimer.current);
                        elevateTimer.current = null;
                    }
                }}
                onBlur={() => {
                    elevateTimer.current = window.setTimeout(() => {
                        setIsElevated(false);
                        elevateTimer.current = null;
                    }, ELEVATE_FALLBACK_MS);
                }}
            >
                <span className={styles.markIcon}>
                    {iconUrl && (
                        <img
                            src={iconUrl}
                            alt={displayName}
                            loading='eager'
                            decoding='async'
                            draggable={'false'}
                        />
                    )}
                </span>
                <span className={styles.nameCell}>
                    <span ref={nameRef} className={styles.markName}>{displayName}</span>
                    <span ref={expandedRef} className={styles.markNameExpanded}>{displayName}</span>
                </span>
                <span className={styles.markStat}>
                    {cnt.collected}/{cnt.total}
                </span>
            </div>
        </div>
    );
};

export default memo(MarkSelector);

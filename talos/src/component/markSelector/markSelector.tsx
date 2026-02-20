import { useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import styles from './markSelector.module.scss';
import { getItemIconUrl } from '@/utils/resource.ts';
import { useTranslateGame } from '@/locale';
import { MarkVisibilityContext } from '../markFilter/visibilityContext';
import {
    useFilter,
    useRegionMarkerCount,
    useSearchString,
} from '@/store/marker.ts';
import { trackedSwitchFilter } from '@/store/trackedActions';

interface MarkSelectorProps {
    typeInfo: { key: string; main?: string; sub?: string };
}

let zCounter = 80;
const nextZ = () => {
    zCounter = zCounter >= 500 ? 50 : zCounter + 1;
    return zCounter;
};

const MarkSelector = ({ typeInfo }: MarkSelectorProps) => {
    type StyleVars = CSSProperties & {
        '--progress-percentage'?: string;
        '--expanded-height'?: string;
    };
    const ELEVATE_FALLBACK_MS = 500; // equal to the CSS transition duration
    const tGame = useTranslateGame();

    // icon url (no extra key munging)
    const iconUrl = useMemo<string | null>(() => {
        return typeInfo?.key ? String(getItemIconUrl(typeInfo.key, 'webp')) : null;
    }, [typeInfo?.key]);

    // i18n display name
    const displayName: string = String(tGame(`markerType.key.${typeInfo.key}`) ?? '');

    // stores
    const filter = useFilter();
    const handleSwitchFilter = useCallback(() => trackedSwitchFilter(typeInfo.key), [typeInfo.key]);
    const cnt = useRegionMarkerCount(typeInfo?.key);
    const searchString = useSearchString();
    
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

    // visibility in current search/filter
    const showFilter = useMemo<boolean>(
        () =>
            Boolean(cnt.total) &&
            (searchString === '' ||
                typeInfo.key.includes(searchString) ||
                displayName.includes(searchString)),
        [cnt.total, searchString, displayName, typeInfo.key],
    );

    // Visibility reporting to parent context (stable id = key)
    const ctx = useContext(MarkVisibilityContext);
    const idRef = useRef<string>(typeInfo?.key);
    useEffect(() => {
        const stableId = idRef.current;
        ctx?.report(stableId, !!showFilter);
        return () => ctx?.report(stableId, false);
    }, [ctx, showFilter]);

    // detect truncation once when displayName changes, and compute expanded height
    // 使用双 rAF 确保布局稳定后再测量，避免强制同步布局开销
    useEffect(() => {
        const el = nameRef.current;
        const expandedEl = expandedRef.current;
        if (!el) return;
        let raf1 = 0;
        let raf2 = 0;
        raf1 = window.requestAnimationFrame(() => {
            raf2 = window.requestAnimationFrame(() => {
                const truncated = el.scrollWidth > el.clientWidth;
                setIsTruncated(truncated);
                if (expandedEl) {
                    const h = expandedEl.scrollHeight;
                    if (Number.isFinite(h) && h > 0) {
                        setExpandedHeightPx(h);
                    }
                }
            });
        });
        return () => {
            if (raf1) window.cancelAnimationFrame(raf1);
            if (raf2) window.cancelAnimationFrame(raf2);
        };
    }, [displayName]);

    // clean elevate fallback timer, avoid setState after unmount
    useEffect(() => () => {
        if (elevateTimer.current) {
            window.clearTimeout(elevateTimer.current);
            elevateTimer.current = null;
        }
    }, []);

    if (!showFilter) return null;
    return (
        <div className={styles.markSkeleton}>
            <div
                className={`${styles.markItem} ${filter.includes(typeInfo.key) ? styles.active : ''} ${isComplete ? styles.completed : ''}`}
                data-key={typeInfo.key}
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
                        <img src={iconUrl} alt={displayName} draggable={'false'} />
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

export default MarkSelector;

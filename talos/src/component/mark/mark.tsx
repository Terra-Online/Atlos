import { useContext, useEffect, useMemo, useRef } from 'react';
import styles from './mark.module.scss';
import { getItemIconUrl } from '../../utils/resource';
import { useTranslate } from '@/locale';
import { MarkVisibilityContext } from '../markFilter/visibilityContext';
import {
    useFilter,
    useRegionMarkerCount,
    useSearchString,
    useSwitchFilter,
} from '../../store/marker';

const Mark = ({
    // points = [],
    typeInfo,
}) => {
    const t = useTranslate();
    // assemble icon_key
    const iconKey = useMemo(() => {
        if (typeInfo?.key) {
            return typeInfo.key.replace(/\s+/g, '_');
        }
        return null;
    }, [typeInfo]);
    // get iconUrl
    const iconUrl = useMemo(() => {
        if (!iconKey) return null;
        return getItemIconUrl(iconKey, 'png');
    }, [iconKey]);
    // get i18n_displayName
    const displayName = t(`markerType.key.${typeInfo.key}`) ?? '';
    // stats
    // const stats = useMemo(() => {
    //   if (!points || !points.length) return { total: 0, collected: 0, percentage: 0 };
    //   const filteredPoints = points.filter(point => {
    //     const typeMatch = (
    //       point.type.main === typeInfo.main &&
    //       point.type.sub === typeInfo.sub &&
    //       (!typeInfo.key || point.type.key === typeInfo.key)
    //     );
    //     const regionMatch = !regionFilter || (
    //       point.region.main === regionFilter.main &&
    //       (!regionFilter.sub || point.region.sub === regionFilter.sub)
    //     );
    //     return typeMatch && regionMatch;
    //   });
    //   const collected = filteredPoints.filter(point =>
    //     point.status?.user?.isCollected
    //   ).length;
    //   return {
    //     total: filteredPoints.length,
    //     collected,
    //     percentage: filteredPoints.length ?
    //       Math.round((collected / filteredPoints.length) * 100) : 0
    //   };
    // }, [points, typeInfo, regionFilter]);

    const filter = useFilter();
    const switchFilter = useSwitchFilter();
    const cnt = useRegionMarkerCount(typeInfo?.key);
    const searchString = useSearchString();
    const showFilter = useMemo(
        () =>
            cnt.total &&
            (searchString === '' ||
                typeInfo.key.includes(searchString) ||
                displayName.includes(searchString)),
        [cnt, searchString, displayName],
    );
    const ctx = useContext(MarkVisibilityContext);
    // 固定一次性的稳定 id，避免因为 i18n 或上层重渲染导致 id 改变从而重复上报
    const idRef = useRef<string>(
        (typeInfo?.key ?? iconKey ?? displayName ?? Math.random().toString(36).slice(2)) as string,
    );
    useEffect(() => {
        // report visibility on mount/update
        ctx?.report(idRef.current, !!showFilter);
        return () => ctx?.report(idRef.current, false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ctx, showFilter]);

    if (!showFilter) return null;
    return (
        <div
            className={`${styles.markItem} ${filter.includes(typeInfo.key) ? styles.active : ''}`}
            onClick={() => switchFilter(typeInfo.key)}
            style={{
                '--progress-percentage': `${cnt.total > 0 ? Math.round((cnt.collected / cnt.total) * 100) : 0}%`,
            }}
        >
            <span className={styles.markIcon}>
                {iconUrl && (
                    <img src={iconUrl} alt={displayName} draggable={'false'} />
                )}
            </span>
            <span className={styles.markName}>{displayName}</span>
            <span className={styles.markStat}>
                {cnt.collected}/{cnt.total}
            </span>
        </div>
    );
};

export default Mark;

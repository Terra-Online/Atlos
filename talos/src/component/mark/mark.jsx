import React, { useMemo } from 'react';
import styles from './mark.module.scss';
import { getItemIconUrl } from '../../utils/resource';

// For deserialization
import i18nData from '../../data/i18n_TC.json';
import { useFilter, usePoints, useRegionMarkerCount, useSearchString, useSwitchFilter } from '../mapContainer/store/marker';

const Mark = ({
  // points = [],
  typeInfo, // { main: "poi", sub: "basic", key: "TP/recycle/base" }
  // regionFilter,
  // totalCount = 0,
  collectedCount = 0
}) => {
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
  const displayName = useMemo(() => {
    if (!typeInfo) return "Unknown";
    const lookups = [
      typeInfo.key && i18nData.key?.[0]?.[typeInfo.key],
      typeInfo.category.sub && i18nData.types?.[0]?.[typeInfo.category.sub.toLowerCase()],
      typeInfo.category.main && i18nData.types?.[0]?.[typeInfo.category.main.toLowerCase()],
      typeInfo.key,
      typeInfo.category.sub,
      typeInfo.category.main,
      "Unknown"
    ];
    return lookups.find(item => !!item) || "Unknown";
  }, [typeInfo, i18nData]);
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
  const searchString = useSearchString()
  const showFilter = useMemo(() =>
    cnt.total && (searchString === "" || typeInfo.key.includes(searchString) || displayName.includes(searchString))
    , [cnt, searchString, displayName])
  if (!showFilter) return null
  return (
    <div
      className={`${styles['mark-item']} ${filter.includes(typeInfo.key) ? styles.active : ''}`}
      onClick={() => switchFilter(typeInfo.key)}
      style={{ '--progress-percentage': `${cnt.total > 0 ? Math.round(cnt.collected / cnt.total * 100) : 0}%` }}
    >
      <span className={styles['mark-icon']}>
        {iconUrl && <img src={iconUrl} alt={displayName} />}
      </span>
      <span className={styles['mark-name']}>{displayName}</span>
      <span className={styles['mark-stat']}>
        {cnt.collected}/{cnt.total}
      </span>
    </div>
  );
};

export default Mark;
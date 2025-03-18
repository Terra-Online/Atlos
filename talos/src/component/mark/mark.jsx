import React, { useMemo } from 'react';
import './mark.scss';
import { getItemIconUrl } from '../../utils/resource';

// For deserialization
import i18nData from '../../data/i18n_TC.json';

const Mark = ({
  points = [],
  typeInfo, // { main: "poi", sub: "basic", key: "TP/recycle/base" }
  regionFilter,
  onFilterClick,
  isFilterActive = false
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
      typeInfo.sub && i18nData.types?.[0]?.[typeInfo.sub.toLowerCase()],
      typeInfo.main && i18nData.types?.[0]?.[typeInfo.main.toLowerCase()],
      typeInfo.key,
      typeInfo.sub,
      typeInfo.main,
      "Unknown"
    ];
    return lookups.find(item => !!item) || "Unknown";
  }, [typeInfo, i18nData]);
  // stats
  const stats = useMemo(() => {
    if (!points || !points.length) return { total: 0, collected: 0, percentage: 0 };
    const filteredPoints = points.filter(point => {
      const typeMatch = (
        point.type.main === typeInfo.main &&
        point.type.sub === typeInfo.sub &&
        (!typeInfo.key || point.type.key === typeInfo.key)
      );
      const regionMatch = !regionFilter || (
        point.region.main === regionFilter.main &&
        (!regionFilter.sub || point.region.sub === regionFilter.sub)
      );
      return typeMatch && regionMatch;
    });
    const collected = filteredPoints.filter(point =>
      point.status?.user?.isCollected
    ).length;
    return {
      total: filteredPoints.length,
      collected,
      percentage: filteredPoints.length ?
        Math.round((collected / filteredPoints.length) * 100) : 0
    };
  }, [points, typeInfo, regionFilter]);

  return (
    <div
      className={`mark-item ${isFilterActive ? 'active' : ''}`}
      onClick={() => onFilterClick && onFilterClick(typeInfo)}
      style={{ '--progress-percentage': `${stats.percentage}%` }}
    >
      <span className="mark-icon">
        {iconUrl && <img src={iconUrl} alt={displayName} />}
      </span>
      <span className="mark-name">{displayName}</span>
      <span className="mark-stat">
        {stats.collected}/{stats.total}
      </span>
    </div>
  );
};

export default Mark;
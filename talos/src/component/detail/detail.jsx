import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import './detail.scss';
import { getItemIconUrl, getCtgrIconUrl } from '../../utils/resource';
import i18nData from '../../data/i18n_EN.json';
import { useMarkerStore } from '../mapContainer/store/marker';
import { useAddPoint, useUserRecord } from '../mapContainer/store/userRecord';
import { MARKER_TYPE_DICT } from '../../data/marker';
import classNames from 'classnames';
import { useClickAway } from 'ahooks';
import { motion, AnimatePresence } from "motion/react"


const mockPoint = {
  id: "001",
  position: [-656.19, 645.58],
  region: {
    main: "Valley_4",
    sub: "pane_1"
  },
  type: {
    main: "resource",
    sub: "natural",
    key: "originium_ore"
  },
  status: {
    user: {
      isCollected: false,
      localNote: "Complete E1M7 to enable the secret path to the point. Open on SAT/SUN only."
    }
  },
  meta: {
    addedBy: "cirisus",
    addedAt: "2025-03-09T15:30:00Z"
  }
};

export const Detail = () => {

  const currentPoint = useMarkerStore((state) => state.currentActivePoint);
  const pointsRecord = useUserRecord()
  const addPoint = useAddPoint()

  const isCollected = currentPoint ? pointsRecord.includes(currentPoint.id) : false;


  const iconKey = currentPoint ? currentPoint.type : "UKN";
  const iconUrl = getItemIconUrl(iconKey);

  const ctgyIconUrl = getCtgrIconUrl(currentPoint ? currentPoint.type.sub : "UKN");

  const pointName = useMemo(() => {
    if (!currentPoint) return "UKN";
    const { type: typeKey } = currentPoint;
    const type = MARKER_TYPE_DICT[typeKey]
    if (!type) return "UKN";
    const lookups = [
      type.key && i18nData.key?.[0]?.[type.key],
      type.sub && i18nData.types?.[0]?.[type.sub.toLowerCase()],
      type.main && i18nData.types?.[0]?.[type.main.toLowerCase()],
      type.key,
      type.sub,
      type.main,
      "UKN"
    ];
    return lookups.find(item => !!item) || "UKN";
  }, [currentPoint]);

  const noteContent = currentPoint?.status?.user?.localNote;

  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef(null);
  useClickAway(() => {
    setIsVisible(false)
  }, ref);
  useEffect(() => { if (currentPoint) setIsVisible(true) }, [currentPoint])

  const handleNextPoint = () => addPoint(currentPoint.id);

  const stats = {
    global: { collected: 12, total: 42 },
    region: { collected: 8, total: 15 },
    type: { collected: 7, total: 7 }
  };
  const statItems = [
    { label: "World", data: stats.global, index: 0 },
    { label: "Main", data: stats.region, index: 1 },
    { label: "Sub", data: stats.type, index: 2 }
  ];// For i18n label

  return (
    <AnimatePresence mode="wait">
      {isVisible && currentPoint && <motion.div
        initial={{ x: "150%" }}
        animate={{ x: "0%" }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        key={currentPoint?.id ?? "null"} className={"detail-container"} ref={ref}>
        {/* Head */}
        <div className="detail-header">
          <div className="point-info">
            {ctgyIconUrl && (
              <span
                className="category-icon"
                style={{ backgroundImage: `url(${ctgyIconUrl})` }}
              ></span>
            )}
            <span className="point-name">{pointName}</span>
          </div>
          <div className="header-actions">
            {!isCollected && <button className="next-button" onClick={handleNextPoint}>
              <span>Complete</span>
            </button>}
          </div>
        </div>
        {/* Content */}
        <div className="detail-content">
          {/* Icon & Stats */}
          <div className="icon-stats-container">
            <div className={classNames("point-icon", { "collected": isCollected })}>
              {iconUrl && <img src={iconUrl} alt={pointName} />}
            </div>
            <div className="point-stats">
              <div className="stats-txt">
                {statItems.map(item => (
                  <div
                    className="stat-row"
                    key={item.label}
                    style={{ transform: `translateY(${3 - item.index * 2}px)` }}
                  >
                    <span className="stat-label">{item.label}: </span>
                    <div className="stat-value">
                      <span className={`user-value ${item.data.collected === item.data.total ? 'check' : ''}`}>
                        {item.data.collected}
                      </span>
                      <span className="value-separator">/</span>
                      <span className="total-value">{item.data.total}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="stats-prog">
                {statItems.map(item => (
                  <div
                    key={`prog-${item.label}`}
                    className={`prog-bar ${item.data.collected === item.data.total ? 'check' : ''}`}
                    style={{ "--prog": item.data.collected / item.data.total }}
                  ></div>
                ))}
              </div>
            </div>
          </div>
          {/* Circumstance */}
          <div className="point-image">
            <div className="no-image">No info.</div>
          </div>
          {/* Note */}
          <div className="detail-notes">
            {noteContent ? (
              <p className="note-text">{noteContent}</p>
            ) : (
              <p className="no-note">No info.</p>
            )}
          </div>
          {/* Wiki */}
          <div className="detail-wiki">
            No info.
          </div>
        </div>
        {/* Meta
      <div className="detail-meta">
        <span>Provided by: {mockPoint.meta?.addedBy || 'UKN'}</span>
        <span>At: {mockPoint.meta?.addedAt ?
          new Date(mockPoint.meta.addedAt).toLocaleDateString() : 'UKN'}</span>
      </div>
      */}
      </motion.div>}
    </AnimatePresence>
  );
};

export default Detail;
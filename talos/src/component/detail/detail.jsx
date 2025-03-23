import React, { useState, useMemo } from 'react';
import './detail.scss';
import { getItemIconUrl, getCtgrIconUrl } from '../../utils/resource';
import i18nData from '../../data/i18n_EN.json';


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
    key: "originium"
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

  const [isVisible, setIsVisible] = useState(true);
  const [isCollected, setIsCollected] = useState(mockPoint.status.user.isCollected);

  if (!isVisible) return null;

  const iconKey = mockPoint.type.key?.replace(/\s+/g, '_') ||
                 `${mockPoint.type.main}_${mockPoint.type.sub}`;
  const iconUrl = getItemIconUrl(iconKey);

  const ctgyIconUrl = getCtgrIconUrl(mockPoint.type.sub);

  const pointName = useMemo(() => {
    const { type } = mockPoint;
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
  }, []);

  const noteContent = mockPoint.status.user.localNote;

  const closeDetail = () => setIsVisible(false);

  const toggleCollected = () => setIsCollected(!isCollected);

  const handleNextPoint = () => console.log("Next point: recommend based on calculated distance.");

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
    <div className="detail-container">
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
                <button className="next-button" onClick={handleNextPoint}>
                <span>Next</span>
                </button>
            </div>
        </div>
      {/* Content */}
      <div className="detail-content">
        {/* Icon & Stats */}
        <div className="icon-stats-container">
          <div className="point-icon">
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
    </div>
  );
};

export default Detail;
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
      "未知点位"
    ];
    return lookups.find(item => !!item) || "未知点位";
  }, []);

  const noteContent = mockPoint.status.user.localNote;

  const closeDetail = () => setIsVisible(false);

  const toggleCollected = () => setIsCollected(!isCollected);

  const handleNextPoint = () => console.log("下一个点位");

  const stats = {
    global: { collected: 12, total: 42 },
    region: { collected: 5, total: 15 },
    type: { collected: 2, total: 7 }
  };
  
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
                NEXT
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
            <div className="stat-row">
              <span className="stat-label">World: </span>
              <span className="stat-value">{stats.global.collected}/{stats.global.total}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Main: </span>
              <span className="stat-value">{stats.region.collected}/{stats.region.total}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Sun: </span>
              <span className="stat-value">{stats.type.collected}/{stats.type.total}</span>
            </div>
          </div>
        </div>
          
          {/* Circumstance */}
          <div className="point-image">
            <div className="no-image">No info.</div>
          </div>
              
      {/* Note */}
      <div className="detail-notes">
        <div className="notes-header">
          <h3>Note</h3>
        </div>
        
        <div className="note-content">
          {noteContent ? (
            <p className="note-text">{noteContent}</p>
          ) : (
            <p className="no-note">No info.</p>
          )}
        </div>

                
        {/* Wiki */}
        <div className="wiki-section">
          <h3>Wiki</h3>
        </div>
      </div>
      </div>


      
      {/* Meta */}
      <div className="detail-meta">
        <span>Provided by: {mockPoint.meta?.addedBy || 'UKN'}</span>
        <span>At: {mockPoint.meta?.addedAt ?
          new Date(mockPoint.meta.addedAt).toLocaleDateString() : 'UKN'}</span>
      </div>
    </div>
  );
};

export default Detail;
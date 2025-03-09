import React, { useState, useRef } from 'react';
import DefaultFilterIcon from '../../asset/logos/filter.svg?react';
import './markFilter.scss';

const MarkFilter = ({ icon: CustomIcon, title = "Filter Options", children }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef(null);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="mark-filter-container">
      <div
        className={`filter-header ${isExpanded ? 'expanded' : ''}`}
        onClick={toggleExpand}
      >
        <div className="filter-icon">
          {CustomIcon ?
            (typeof CustomIcon === 'function' ?
              <CustomIcon className="icon" /> :
              CustomIcon) :
            <DefaultFilterIcon className="icon" />}
        </div>
        <div className="filter-title">{title}</div>
        <div className="toggle-icon">
          <svg viewBox="0 0 24 24" className={isExpanded ? 'expanded' : ''}>
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
          </svg>
        </div>
      </div>

      <div
        ref={contentRef}
        className={`filter-content ${isExpanded ? 'expanded' : ''}`}
      >
        <div className={`content-inner ${isExpanded ? 'visible' : ''}`}>
          {children || (
            <div className="placeholder-content">
              <p>我能夠吞下玻璃而不受損傷。</p>
              <p>The quick brown fox jumps over the lazy dog.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MarkFilter;
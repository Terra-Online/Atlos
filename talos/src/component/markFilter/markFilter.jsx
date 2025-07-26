import React, { useState, useRef } from 'react';
import DefaultFilterIcon from '../../asset/logos/filter.svg?react';
import styles from './markFilter.module.scss';

const MarkFilter = ({ icon: CustomIcon, title = "Filter Options", children }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef(null);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className={styles['mark-filter-container']}>
      <div
        className={`${styles['filter-header']} ${isExpanded ? styles.expanded : ''}`}
        onClick={toggleExpand}
      >
        <div className={styles['filter-icon']}>
          {CustomIcon ?
            (typeof CustomIcon === 'function' ?
              <CustomIcon className={styles.icon} /> :
              CustomIcon) :
            <DefaultFilterIcon className={styles.icon} />}
        </div>
        <div className={styles['filter-title']}>{title}</div>
        <div className={styles['toggle-icon']}>
          <svg viewBox="0 0 24 24" className={isExpanded ? styles.expanded : ''}>
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
          </svg>
        </div>
      </div>

      <div
        ref={contentRef}
        className={`${styles['filter-content']} ${isExpanded ? styles.expanded : ''}`}
      >
        <div className={`${styles['content-inner']} ${isExpanded ? styles.visible : ''}`}>
          {children || (
            <div className={styles['placeholder-content']}>
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
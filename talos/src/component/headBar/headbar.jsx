import React from 'react';
import styles from './headbar.module.scss';

const Headitem = ({
  icon: Icon,
  onClick,
  tooltip = '',
  active = false,
  disabled = false
}) => {
  const handleClick = (e) => {
    e.preventDefault();
    if (!disabled && onClick) {
      onClick();
    }
  };

  return (
    <button
      className={`${styles['headbar-item']} ${active ? styles.active : ''} ${disabled ? styles.disabled : ''}`}
      onClick={handleClick}
      disabled={disabled}
      title={tooltip}
    >
      <div className={styles['headbar-icon']}>
        {Icon && <Icon />}
      </div>
    </button>
  );
};

// modified (changed UI but sidebar binding reserved)
const Headbar = ({ children, isSidebarOpen = false }) => {
  return (
    <div className={styles['headbar-container']}>
      <div className={styles.headbar}>
        {children}
      </div>
    </div>
  );
};

export { Headitem, Headbar };
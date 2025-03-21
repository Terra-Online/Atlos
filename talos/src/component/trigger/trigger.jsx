import React, { useEffect, useRef } from 'react';
import './trigger.scss';

import OnIcon from '../../asset/logos/on.svg?react';
import OffIcon from '../../asset/logos/off.svg?react';

const Trigger = ({
  isActive = false,
  onToggle,
  label = '',
  disabled = false
}) => {
  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && onToggle) {
      onToggle(!isActive);
    }
  };

  return (
    <div className={`trigger ${disabled ? 'disabled' : ''}`}>
      <button
        className={`trigger-button ${isActive ? 'active' : ''}`}
        onClick={handleClick}
        disabled={disabled}
      >
        <div className="trigger-icons">
          <span className="trigger-icon off">
            <OffIcon />
          </span>
          <span className="trigger-icon on">
            <OnIcon />
          </span>
        </div>

      </button>
      {label && <div className="trigger-label">{label}</div>}
    </div>
  );
};

const TriggerBar = ({
  children,
  isSidebarOpen = false
}) => {
  const prevSidebarStateRef = useRef(isSidebarOpen);

  /* debug
  useEffect(() => {
    if (prevSidebarStateRef.current !== isSidebarOpen) {
      console.log("TriggerArea receive sideBar.jsx:", isSidebarOpen);
      prevSidebarStateRef.current = isSidebarOpen;
    }
  }, [isSidebarOpen]);
  */

  return (
    <div className={`trigger-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      {children}
    </div>
  );
};

export { Trigger, TriggerBar };
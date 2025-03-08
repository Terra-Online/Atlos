import React from 'react';
import './headbar.scss';

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
      className={`headbar-item ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={handleClick}
      disabled={disabled}
      title={tooltip}
    >
      <div className="headbar-icon">
        {Icon && <Icon />}
      </div>
    </button>
  );
};

// modified (changed UI but sidebar binding reserved)
const Headbar = ({ children, isSidebarOpen = false }) => {
  return (
    <div className="headbar-container">
      <div className="headbar">
        {children}
      </div>
    </div>
  );
};

export { Headitem, Headbar };
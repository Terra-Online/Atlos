import React from 'react';
import './regSwitch.scss';

const Reg = ({
  icon: Icon,
  value,
  isSelected = false,
  tooltip = '',
  disabled = false,
  onClick
}) => {
  return (
    <button
      className={`reg-item ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <div className="reg-icon">
        {Icon && <Icon />}
      </div>
      {tooltip && <div className="reg-tooltip">{tooltip}</div>}
    </button>
  );
};

const RegSwitch = ({
  children,
  value,
  onChange,
  isSidebarOpen = false
}) => {
  // check selectedIndex
  let selectedIndex = -1;
  React.Children.forEach(children, (child, index) => {
    if (React.isValidElement(child) && child.props.value === value) {
      selectedIndex = index;
    }
  });

  // inject props
  const childrenWithProps = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      return React.cloneElement(child, { 
        isSelected: child.props.value === value,
        onClick: () => onChange(child.props.value)
      });
    }
    return child;
  });

  return (
    <div className={`regswitch-container ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <div className={`regswitch ${selectedIndex >= 0 ? `selected-${selectedIndex}` : ''}`}>
        {childrenWithProps}
      </div>
    </div>
  );
};

export { Reg, RegSwitch };
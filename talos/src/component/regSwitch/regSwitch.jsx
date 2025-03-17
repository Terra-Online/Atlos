import React, { useState, useRef, useEffect } from 'react';
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

const SubReg = ({
  color,
  value,
  isSelected = false,
  tooltip = '',
  disabled = false,
  onClick
}) => {
  return (
    <button
      className={`subreg-item ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <div className="subreg-icon">
        <div
          className="subreg-color-block"
          style={{ backgroundColor: color }}
        ></div>
      </div>
      {tooltip && <div className="subreg-tooltip">{tooltip}</div>}
    </button>
  );
};

const RegionContainer = ({ children, isSidebarOpen = false }) => {
  const [isHovering, setIsHovering] = useState(false);
  const timeoutRef = useRef(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsHovering(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsHovering(false);
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // 过滤并处理子元素
  const mainRegion = React.Children.toArray(children).find(
    child => child.type === RegSwitch
  );

  const subRegion = React.Children.toArray(children).find(
    child => child.type === SubRegSwitch
  );

  return (
    <div
      className={`region-selection-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {mainRegion}

      {subRegion && React.cloneElement(subRegion, {
        visible: isHovering,
        isSidebarOpen: isSidebarOpen
      })}
    </div>
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

const SubRegSwitch = ({
  children,
  value,
  onChange,
  isSidebarOpen = false,
  visible = false
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
    <div className={`subregswitch-container ${isSidebarOpen ? 'sidebar-open' : ''} ${visible ? 'visible' : ''}`}>
      <div className={`subregswitch ${selectedIndex >= 0 ? `selected-${selectedIndex}` : ''}`}>
        {childrenWithProps}
      </div>
    </div>
  );
};

export { Reg, RegSwitch, SubReg, SubRegSwitch, RegionContainer };
import React, { useState, useRef, useEffect } from 'react';
import './regSwitch.scss';

const Reg = ({
  icon: Icon,
  value,
  isSelected = false,
  tooltip = '',
  disabled = false,
  onClick,
  hasSubregions = false,
  onMouseEnter,
  onMouseLeave
}) => {
  return (
    <button
      className={`reg-item ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''} ${hasSubregions && isSelected ? 'has-subregions' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      onMouseEnter={isSelected && hasSubregions ? onMouseEnter : undefined}
      onMouseLeave={isSelected && hasSubregions ? onMouseLeave : undefined}
    >
      <div className="reg-icon">
        {Icon && <Icon />}
      </div>
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
    </button>
  );
};

const RegionContainer = ({ children, isSidebarOpen = false }) => {
  const [isHovering, setIsHovering] = useState(false);
  const timeoutRef = useRef(null);
  const containerRef = useRef(null);
  const handleMainRegionMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsHovering(true);
  };
  const handleMainRegionMouseLeave = (e) => {
    const toElement = e.relatedTarget;
    const container = containerRef.current;
    if (container && container.contains(toElement) && toElement.closest('.subregswitch-container')) {
      return;
    }
    timeoutRef.current = setTimeout(() => {
      setIsHovering(false);
    }, 300);
  };

  const handleContainerMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsHovering(false);
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Filter and process child elements
  const mainRegion = React.Children.toArray(children).find(
    child => child.type === RegSwitch
  );

  const subRegion = React.Children.toArray(children).find(
    child => child.type === SubRegSwitch
  );

  // Check if subRegion has any child elements
  const hasSubregions = subRegion && React.Children.count(subRegion.props.children) > 0;

  let selectedIndex = -1;
  if (mainRegion && mainRegion.props.children) {
    React.Children.forEach(mainRegion.props.children, (child, index) => {
      if (React.isValidElement(child) && child.props.value === mainRegion.props.value) {
        selectedIndex = index;
      }
    });
  }

  // Clone mainRegion to pass additional props to its children
  const mainRegionWithProps = mainRegion
    ? React.cloneElement(mainRegion, {
      hasSubregions,
      onRegionMouseEnter: handleMainRegionMouseEnter,
      onRegionMouseLeave: handleMainRegionMouseLeave
    })
    : null;

  // Clone subRegion to pass mouse handlers
  const subRegionWithProps = subRegion && hasSubregions
    ? React.cloneElement(subRegion, {
      visible: isHovering,
      isSidebarOpen: isSidebarOpen,
      alignClass: `align-item-${selectedIndex}`,
      onMouseEnter: () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      },
      onMouseLeave: (e) => {
        const toElement = e.relatedTarget;
        if (!toElement || !toElement.closest('.regswitch-container')) {
          timeoutRef.current = setTimeout(() => {
            setIsHovering(false);
          }, 300);
        }
      }
    })
    : null;

  return (
    <div
      ref={containerRef}
      className={`region-selection-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`}
      onMouseLeave={handleContainerMouseLeave}
    >
      {mainRegionWithProps}
      {subRegionWithProps}
    </div>
  );
};

const RegSwitch = ({
  children,
  value,
  onChange,
  isSidebarOpen = false,
  hasSubregions = false,
  onRegionMouseEnter,
  onRegionMouseLeave
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
        onClick: () => onChange(child.props.value),
        hasSubregions: hasSubregions && child.props.value === value,
        onMouseEnter: onRegionMouseEnter,
        onMouseLeave: onRegionMouseLeave
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
  visible = false,
  alignClass = '',
  onMouseEnter,
  onMouseLeave
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
    <div
      className={`subregswitch-container ${isSidebarOpen ? 'sidebar-open' : ''} ${visible ? 'visible' : ''} ${alignClass}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={`subregswitch ${selectedIndex >= 0 ? `selected-${selectedIndex}` : ''}`}>
        {childrenWithProps}
      </div>
    </div>
  );
};

export { Reg, RegSwitch, SubReg, SubRegSwitch, RegionContainer };
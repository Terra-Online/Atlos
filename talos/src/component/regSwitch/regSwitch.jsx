import React, { useState, useRef, useEffect } from 'react';
import styles from './regSwitch.module.scss';

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
      className={`${styles['reg-item']} ${isSelected ? styles.selected : ''} ${disabled ? styles.disabled : ''} ${hasSubregions && isSelected ? styles['has-subregions'] : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      onMouseEnter={isSelected && hasSubregions ? onMouseEnter : undefined}
      onMouseLeave={isSelected && hasSubregions ? onMouseLeave : undefined}
    >
      <div className={styles['reg-icon']}>
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
      className={`${styles['subreg-item']} ${isSelected ? styles.selected : ''} ${disabled ? styles.disabled : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <div className={styles['subreg-icon']}>
        <div
          className={styles['subreg-color-block']}
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
      onRegionMouseLeave: handleMainRegionMouseLeave,
      selectedIndex
    })
    : null;

  // Clone subRegion to pass mouse handlers
  const subRegionWithProps = subRegion && hasSubregions
    ? React.cloneElement(subRegion, {
      visible: isHovering,
      isSidebarOpen: isSidebarOpen,
      alignClass: `align-item-${selectedIndex}`,
      selectedIndex,
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
      className={`${styles['region-selection-wrapper']} ${isSidebarOpen ? styles['sidebar-open'] : ''}`}
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
  onRegionMouseLeave,
  selectedIndex = -1
}) => {
  const getIndicatorStyle = () => {
    if (selectedIndex < 0) return { display: 'none' };
    // Calculate the position of the indicator based on selectedIndex
    const itemHeight = 2.5; // rem
    const itemGap = 0.6; // rem
    const indicatorHeight = 0.75; // rem

    const translateY = selectedIndex * (itemHeight + itemGap) + (itemHeight / 2) - (indicatorHeight / 2);

    return {
      transform: `translateY(${translateY}rem)`,
      opacity: 1
    };
  };

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
    <div className={`${styles['regswitch-container']} ${isSidebarOpen ? styles['sidebar-open'] : ''}`}>
      <div className={styles['regswitch']}>
        {/* 动态创建指示器元素 */}
        <div 
          className={styles['indicator']}
          style={getIndicatorStyle()}
        />
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
  selectedIndex = -1,
  onMouseEnter,
  onMouseLeave
}) => {
  // Calculate the position of the container based on selectedIndex
  const getContainerStyle = () => {
    if (selectedIndex < 0) return {};

    const itemHeight = 2.5; // rem
    const itemGap = 0.6; // rem

    const top = selectedIndex * (itemHeight + itemGap) + (itemHeight / 2) + 0.3125; // 0.3125 rem = 5px
    return {
      top: `${top}rem`
    };
  };

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
      className={`${styles['subregswitch-container']} ${isSidebarOpen ? styles['sidebar-open'] : ''} ${visible ? styles.visible : ''}`}
      style={getContainerStyle()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles['subregswitch']}>
        {childrenWithProps}
      </div>
    </div>
  );
};

export { Reg, RegSwitch, SubReg, SubRegSwitch, RegionContainer };
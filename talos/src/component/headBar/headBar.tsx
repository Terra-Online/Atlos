import styles from './headbar.module.scss';
import LiquidGlass from 'liquid-glass-react-positioning';
import React from "react";

interface HeadBarProps {
  children: React.ReactNode;
  isSidebarOpen: boolean;
}

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
        {Icon && <Icon/>}
      </div>
    </button>
  );
};

// modified (changed UI but sidebar binding reserved)
const HeadBar = ({children}: HeadBarProps) => {
  return (
    <LiquidGlass
      displacementScale={60}
      blurAmount={0}
      saturation={120}
      aberrationIntensity={2}
      elasticity={0.1}
      cornerRadius={50}
      padding="8px 16px"
      mode="standard"
      overLight={false}
      positioning="top-right"
      className="headbar-container"
      style={{
        position: "fixed",
        top: "1rem",
        right: "1rem",
      }}
    >
      <div className={styles['headbar']}>
        {children}
      </div>
    </LiquidGlass>
  );
};

export {Headitem, HeadBar};
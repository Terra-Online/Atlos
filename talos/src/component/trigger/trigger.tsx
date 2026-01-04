import styles from './trigger.module.scss';

import OnIcon from '../../assets/logos/on.svg?react';
import OffIcon from '../../assets/logos/off.svg?react';
import React from 'react';

interface TriggerProps {
    isActive?: boolean;
    onToggle?: (isActive: boolean) => void;
    label?: string;
    disabled?: boolean;
}

const Trigger = ({
    isActive = false,
    onToggle,
    label = '',
    disabled = false,
}: TriggerProps) => {
    const handleClick = (
        e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    ) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled && onToggle) {
            onToggle(!isActive);
        }
    };

    return (
        <div className={`${styles.trigger} ${disabled ? styles.disabled : ''}`}>
            <button
                className={`${styles.triggerButton} ${isActive ? styles.active : ''}`}
                onClick={handleClick}
                disabled={disabled}
                aria-label={label}
            >
                <div className={styles.triggerIcons}>
                    <span className={`${styles.triggerIcon} ${styles.off}`}>
                        <OffIcon />
                    </span>
                    <span className={`${styles.triggerIcon} ${styles.on}`}>
                        <OnIcon />
                    </span>
                </div>
            </button>
            {label && <div className={styles.triggerLabel}>{label}</div>}
        </div>
    );
};

const TriggerBar = ({ children }) => {
    // const prevSidebarStateRef = useRef(isSidebarOpen);

    /* debug
  useEffect(() => {
    if (prevSidebarStateRef.current !== isSidebarOpen) {
      console.log("TriggerArea receive sideBar.jsx:", isSidebarOpen);
      prevSidebarStateRef.current = isSidebarOpen;
    }
  }, [isSidebarOpen]);
  */

    return <div className={styles.triggerContainer}>{children}</div>;
};

export { Trigger, TriggerBar };

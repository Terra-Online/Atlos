import styles from './trigger.module.scss';

import OnIcon from '../../asset/logos/on.svg?react';
import OffIcon from '../../asset/logos/off.svg?react';
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
                className={`${styles['trigger-button']} ${isActive ? styles.active : ''}`}
                onClick={handleClick}
                disabled={disabled}
            >
                <div className={styles['trigger-icons']}>
                    <span className={`${styles['trigger-icon']} ${styles.off}`}>
                        <OffIcon />
                    </span>
                    <span className={`${styles['trigger-icon']} ${styles.on}`}>
                        <OnIcon />
                    </span>
                </div>
            </button>
            {label && <div className={styles['trigger-label']}>{label}</div>}
        </div>
    );
};

const TriggerBar = ({ children, isSidebarOpen = false }) => {
    // const prevSidebarStateRef = useRef(isSidebarOpen);

    /* debug
  useEffect(() => {
    if (prevSidebarStateRef.current !== isSidebarOpen) {
      console.log("TriggerArea receive sideBar.jsx:", isSidebarOpen);
      prevSidebarStateRef.current = isSidebarOpen;
    }
  }, [isSidebarOpen]);
  */

    return (
        <div
            className={`${styles['trigger-container']} ${isSidebarOpen ? styles['sidebar-open'] : ''}`}
        >
            {children}
        </div>
    );
};

export { Trigger, TriggerBar };

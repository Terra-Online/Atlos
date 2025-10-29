import styles from './headbar.module.scss';
import React, { useState, useEffect } from 'react';
import HeadBarDesktop from './headBar.desktop';
import HeadBarMobile from './headBar.mobile';

interface HeadBarProps {
    children: React.ReactNode;
    isSidebarOpen: boolean;
}

interface HeadItemProps {
    icon: React.FC;
    onClick?: () => void;
    tooltip?: string;
    active?: boolean;
    disabled?: boolean;
}

const HeadItem = ({
    icon: Icon,
    onClick,
    tooltip = '',
    active = false,
    disabled = false,
}: HeadItemProps) => {
    const handleClick = (
        e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    ) => {
        e.preventDefault();
        if (!disabled && onClick) {
            onClick();
        }
    };

    return (
        <button
            className={`${styles.headbarItem} ${active ? styles.active : ''} ${disabled ? styles.disabled : ''}`}
            onClick={handleClick}
            disabled={disabled}
            title={tooltip}
        >
            <div className={styles.headbarIcon}>{Icon && <Icon />}</div>
        </button>
    );
};

// Main HeadBar component with responsive detection
const HeadBar = ({ children }: HeadBarProps) => {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth <= 768);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    return isMobile ? (
        <HeadBarMobile>{children}</HeadBarMobile>
    ) : (
        <HeadBarDesktop>{children}</HeadBarDesktop>
    );
};

export { HeadItem, HeadBar };

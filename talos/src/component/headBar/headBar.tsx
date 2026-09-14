import React from 'react';
import { useDevice } from '@/platform/device';
import { useForceHeadbarExpanded } from '@/store/uiPrefs';
import PopoverTooltip from '@/component/popover/popover';

import HeadBarDesktop from './headBar.desktop';
import HeadBarMobile from './headBar.mobile';

import styles from './headbar.module.scss';

interface HeadItemProps {
    icon: React.FC;
    onClick?: () => void;
    tooltip?: React.ReactNode;
    ariaLabel?: string;
    active?: boolean;
    disabled?: boolean;
    badge?: boolean;
    guideKey?: string;
    compactHidden?: boolean;
}

const HeadItem = ({
    icon: Icon,
    onClick,
    tooltip = '',
    ariaLabel,
    active = false,
    disabled = false,
    badge = false,
    guideKey,
    compactHidden = false,
}: HeadItemProps) => {
    const handleClick = (
        e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    ) => {
        e.preventDefault();
        if (!disabled && onClick) {
            onClick();
        }
    };

    const button = (
        <button
            className={`${styles.headbarItem} ${active ? styles.active : ''} ${disabled ? styles.disabled : ''} ${compactHidden ? styles.compactHidden : ''}`}
            onClick={handleClick}
            disabled={disabled}
            aria-label={ariaLabel ?? (typeof tooltip === 'string' ? tooltip : undefined)}
            aria-hidden={compactHidden || undefined}
            tabIndex={compactHidden ? -1 : undefined}
            data-guide={guideKey}
        >
            <div className={styles.headbarIcon}>{Icon && <Icon />}</div>
            {badge && <span className={styles.badge} data-badge={guideKey} />}
        </button>
    );

    if (!tooltip) {
        return button;
    }

    return (
        <PopoverTooltip content={tooltip} placement="bottom">
            {button}
        </PopoverTooltip>
    );
};

// Main HeadBar component with responsive detection
const HeadBar = ({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) => {
    const { isMobile } = useDevice();
    const forceHeadbarExpanded = useForceHeadbarExpanded();
    const displayedChildren = React.Children.map(children, (child) => {
        if (!React.isValidElement<HeadItemProps>(child)) return child;
        return React.cloneElement(child, {
            compactHidden: compact && child.props.guideKey !== 'hide-ui',
        });
    });

    return isMobile ? (
        <HeadBarMobile forceExpanded={forceHeadbarExpanded} compact={compact}>
            {displayedChildren}
        </HeadBarMobile>
    ) : (
        <HeadBarDesktop compact={compact}>{displayedChildren}</HeadBarDesktop>
    );
};

export { HeadItem, HeadBar };

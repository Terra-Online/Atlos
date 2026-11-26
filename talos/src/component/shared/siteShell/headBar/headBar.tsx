import IconButton from '@/component/button/IconButton';
import React, { useEffect, useRef, useState } from 'react';
import { useDevice } from '@/platform/device';
import { useForceHeadbarExpanded, usePerformanceMode } from '@/store/uiPrefs';
import { useAppDocument } from '@/platform/pictureInPicture';
import CloseIcon from '@/assets/logos/close.svg?react';
import PopoverTooltip from '@/component/popover/popover';
import GlassSurface from './glassSurface';

import styles from '@/component/shared/siteShell/headBar/headbar.module.scss';

interface HeadItemProps {
    icon: React.FC;
    iconScale?: number;
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
    iconScale = 1,
    onClick,
    tooltip = '',
    ariaLabel,
    active = false,
    disabled = false,
    badge = false,
    guideKey,
    compactHidden = false,
}: HeadItemProps) => {
    const { isMobile } = useDevice();
    const handleClick = (
        e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    ) => {
        e.preventDefault();
        if (!disabled && onClick) {
            onClick();
        }
    };

    const button = (
        <IconButton
            label={ariaLabel ?? (typeof tooltip === 'string' ? tooltip : 'Actions')}
            pressed={active}
            className={`${styles.headbarItem} ${active ? styles.active : ''} ${disabled ? styles.disabled : ''} ${compactHidden ? styles.compactHidden : ''}`}
            onClick={handleClick}
            disabled={disabled}
            aria-hidden={compactHidden || undefined}
            tabIndex={compactHidden ? -1 : undefined}
            data-guide={guideKey}
        >
            <div
                className={styles.headbarIcon}
                style={{ '--headbar-icon-scale': iconScale } as React.CSSProperties}
            >
                {Icon && <Icon />}
            </div>
            {badge && <span className={styles.badge} data-badge={guideKey} />}
        </IconButton>
    );

    if (!tooltip) {
        return button;
    }

    return (
        <PopoverTooltip content={tooltip} placement="bottom" disabled={isMobile || compactHidden || disabled}>
            {button}
        </PopoverTooltip>
    );
};

const HeadBar = ({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) => {
    const { isMobile } = useDevice();
    const appDocument = useAppDocument();
    const performanceMode = usePerformanceMode();
    const forceExpanded = useForceHeadbarExpanded();
    const [expanded, setExpanded] = useState(false);
    const barRef = useRef<HTMLDivElement>(null);
    const actualExpanded = isMobile && !compact && (forceExpanded ?? expanded);

    useEffect(() => {
        if (!actualExpanded || forceExpanded !== null) return;
        const doc = barRef.current?.ownerDocument;
        if (!doc) return;
        const closeOutside = (event: PointerEvent) => {
            if (!barRef.current?.contains(event.target as Node)) setExpanded(false);
        };
        doc.addEventListener('pointerdown', closeOutside, true);
        return () => doc.removeEventListener('pointerdown', closeOutside, true);
    }, [actualExpanded, appDocument, forceExpanded]);

    const displayedChildren = React.Children.map(children, (child) => {
        if (!React.isValidElement<HeadItemProps>(child)) return child;
        return React.cloneElement(child, {
            compactHidden: compact && child.props.guideKey !== 'hide-ui',
        });
    });
    const compactClass = compact ? styles.visibilityOnly : '';
    const bar = isMobile ? (
        <div
            ref={barRef}
            data-guide="headbar"
            className={`${styles.headbarMobile} ${actualExpanded ? styles.expanded : styles.collapsed} ${compactClass}`}
        >
            <div className={styles.headbarGrid}>
                {!compact && (
                    <button
                        type="button"
                        className={styles.toggleIcon}
                        onClick={() => setExpanded((value) => !value)}
                        aria-expanded={actualExpanded}
                        disabled={forceExpanded !== null}
                    >
                        <CloseIcon />
                    </button>
                )}
                {displayedChildren}
            </div>
        </div>
    ) : (
        <div data-guide="headbar" className={`${styles.headbar} ${compactClass}`}>
            {displayedChildren}
        </div>
    );

    return !performanceMode ? (
        <GlassSurface mobile={isMobile} compact={compact} expanded={actualExpanded}>{bar}</GlassSurface>
    ) : (
        <div className={`${styles.headbarFallback} ${!isMobile && compact ? styles.compactFallback : ''}`}>
            {bar}
        </div>
    );
};

export { HeadItem, HeadBar };

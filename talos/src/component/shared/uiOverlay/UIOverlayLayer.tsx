import type { CSSProperties, ReactNode } from 'react';
import styles from './UIOverlay.module.scss';

/** Shared viewport overlay; only its controls receive pointer input. */
export function UIOverlayLayer({
    children,
    mobile,
    sidebarOpen,
}: {
    children: ReactNode;
    mobile: boolean;
    sidebarOpen: boolean;
}) {
    return (
        <div
            data-font-region='shell'
            className={`${styles.uiOverlay} ${mobile ? styles.mobile : ''} ${sidebarOpen ? styles.sidebarOpen : ''}`}
        >
            {children}
        </div>
    );
}
export function SwitchArea({
    children,
    snap,
    style,
}: {
    children: ReactNode;
    snap?: number;
    style?: CSSProperties;
}) {
    return (
        <div className={styles.switchArea} data-snap={snap} style={style}>
            {children}
        </div>
    );
}

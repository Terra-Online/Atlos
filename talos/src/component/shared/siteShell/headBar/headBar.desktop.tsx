import styles from '@/component/shared/siteShell/headBar/headbar.module.scss';
import GlassSurface from './glassSurface';
import React from 'react';
import { usePerformanceMode } from '@/store/uiPrefs';
import HeadBarDesktopFallback from '@/component/shared/siteShell/headBar/headBar.desktop.fallback';

interface HeadBarDesktopProps {
    children: React.ReactNode;
    compact?: boolean;
}

const HeadBarDesktop: React.FC<HeadBarDesktopProps> = ({ children, compact = false }) => {
    const performanceMode = usePerformanceMode();

    // Use fallback component in performance mode
    if (performanceMode) {
        return <HeadBarDesktopFallback compact={compact}>{children}</HeadBarDesktopFallback>;
    }

    return (
        <GlassSurface compact={compact}>
            <div data-guide='headbar' className={`${styles.headbar} ${compact ? styles.visibilityOnly : ''}`}>
                {children}
            </div>
        </GlassSurface>
    );
};

export default HeadBarDesktop;

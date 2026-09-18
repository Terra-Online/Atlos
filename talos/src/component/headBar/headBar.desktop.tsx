import styles from './headbar.module.scss';
import LiquidGlass from 'liquid-glass-react-positioning';
import React from 'react';
import { usePerformanceMode } from '@/store/uiPrefs';
import HeadBarDesktopFallback from './headBar.desktop.fallback';

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
        <LiquidGlass
            displacementScale={60}
            blurAmount={0}
            saturation={120}
            aberrationIntensity={2}
            elasticity={0.1}
            cornerRadius={50}
            padding={compact ? '8px' : '8px 16px'}
            mode='standard'
            overLight={false}
            positioning='top-right'
            style={{
                position: 'fixed',
                top: 'max(1rem, env(safe-area-inset-top, 0px))',
                right: '1rem',
                backgroundColor: 'var(--headbar-bg)',
                borderRadius: '50%',
                transition: 'padding 0.3s ease',
            }}
        >
            <div data-guide='headbar' className={`${styles.headbar} ${compact ? styles.visibilityOnly : ''}`}>
                {children}
            </div>
        </LiquidGlass>
    );
};

export default HeadBarDesktop;

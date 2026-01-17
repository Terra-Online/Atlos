import styles from './headbar.module.scss';
import LiquidGlass from 'liquid-glass-react-positioning';
import React, { useState, useEffect, useRef } from 'react';
import CloseIcon from '../../assets/logos/close.svg?react';
import { usePerformanceMode } from '@/store/uiPrefs';
import HeadBarMobileFallback from './headBar.mobile.fallback';

interface HeadBarMobileProps {
    children: React.ReactNode;
}

const HeadBarMobile: React.FC<HeadBarMobileProps> = ({ children }) => {
    const performanceMode = usePerformanceMode();
    const [isExpanded, setIsExpanded] = useState(false);
    const childrenArray = React.Children.toArray(children);
    const containerRef = useRef<HTMLDivElement>(null);

    const toggleExpand = () => {
        setIsExpanded(!isExpanded);
    };

    // Auto-collapse when clicking outside
    useEffect(() => {
        if (!isExpanded) return;

        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsExpanded(false);
            }
        };

        // Add listeners for both mouse and touch events
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isExpanded]);

    // Use fallback component in performance mode
    if (performanceMode) {
        return <HeadBarMobileFallback>{children}</HeadBarMobileFallback>;
    }

    return (
        <LiquidGlass
            displacementScale={20}
            blurAmount={0}
            saturation={20}
            aberrationIntensity={2}
            elasticity={0.1}
            cornerRadius={36}
            padding={isExpanded ? '12px' : '8px'}
            mode='standard'
            overLight={false}
            positioning='top-right'
            border1Transition='none'
            border2Transition='none'
            style={{
                position: 'fixed',
                top: '1rem',
                right: '1rem',
                backgroundColor: 'var(--headbar-bg)',
                borderRadius: '36px',
                transition: 'padding 0.3s ease',
            }}
        >
            <div
                ref={containerRef}
                className={`${styles.headbarMobile} ${isExpanded ? styles.expanded : styles.collapsed}`}
            >
                <div className={styles.headbarGrid}>
                    <button
                        className={styles.toggleIcon}
                        onClick={toggleExpand}
                    >
                        <CloseIcon />
                    </button>
                    {childrenArray}
                </div>
            </div>
        </LiquidGlass>
    );
};

export default HeadBarMobile;
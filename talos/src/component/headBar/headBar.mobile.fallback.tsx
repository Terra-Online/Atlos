import styles from './headbar.module.scss';
import React, { useState, useEffect, useRef } from 'react';
import CloseIcon from '../../assets/logos/close.svg?react';

interface HeadBarMobileFallbackProps {
    children: React.ReactNode;
    forceExpanded?: boolean | null;
    compact?: boolean;
}

const HeadBarMobileFallback: React.FC<HeadBarMobileFallbackProps> = ({ children, forceExpanded = null, compact = false }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const actualExpanded = !compact && (forceExpanded !== null ? forceExpanded : isExpanded);
    const childrenArray = React.Children.toArray(children);
    const containerRef = useRef<HTMLDivElement>(null);

    const toggleExpand = () => {
        setIsExpanded(!isExpanded);
    };

    // Auto-collapse when clicking outside (only if not force-controlled)
    useEffect(() => {
        if (!actualExpanded || forceExpanded !== null) return;

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
    }, [actualExpanded, forceExpanded]);

    return (
        <div
            className={styles.headbarFallback}
            style={{
                position: 'fixed',
                top: 'max(1rem, env(safe-area-inset-top, 0px))',
                right: '1rem',
            }}
        >
            <div
                ref={containerRef}
                data-guide='headbar'
                className={`${styles.headbarMobile} ${actualExpanded ? styles.expanded : styles.collapsed} ${compact ? styles.visibilityOnly : ''}`}
            >
                <div className={styles.headbarGrid}>
                    {!compact && (
                        <button
                            className={styles.toggleIcon}
                            onClick={toggleExpand}
                            disabled={forceExpanded !== null}
                        >
                            <CloseIcon />
                        </button>
                    )}
                    {childrenArray}
                </div>
            </div>
        </div>
    );
};

export default HeadBarMobileFallback;

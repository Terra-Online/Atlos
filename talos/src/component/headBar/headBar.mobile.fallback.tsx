import styles from './headbar.module.scss';
import React, { useState, useEffect, useRef } from 'react';
import CloseIcon from '../../assets/logos/close.svg?react';

interface HeadBarMobileFallbackProps {
    children: React.ReactNode;
}

const HeadBarMobileFallback: React.FC<HeadBarMobileFallbackProps> = ({ children }) => {
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

    return (
        <div
            className={styles.headbarFallback}
            style={{
                position: 'fixed',
                top: '1rem',
                right: '1rem',
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
        </div>
    );
};

export default HeadBarMobileFallback;
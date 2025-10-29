import styles from './headbar.module.scss';
import LiquidGlass from 'liquid-glass-react-positioning';
import React, { useState } from 'react';
import CloseIcon from '../../assets/logos/close.svg?react';

interface HeadBarMobileProps {
    children: React.ReactNode;
}

const HeadBarMobile: React.FC<HeadBarMobileProps> = ({ children }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const childrenArray = React.Children.toArray(children);
    const animationRef = React.useRef<number | null>(null);

    const toggleExpand = () => {
        setIsExpanded(!isExpanded);
    
        // Cancel any ongoing animation
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }
        
        // Continuously trigger resize during transition to update LiquidGlass
        const startTime = Date.now();
        const duration = 300;
        let toggle = false;
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            
            if (elapsed < duration) {
                // add a tiny jitter to force resize event
                const offset = toggle ? 0.01 : 0;
                toggle = !toggle;
                
                const originWidth = window.innerWidth;
                const originHeight = window.innerHeight;
                
                Object.defineProperty(window, 'innerWidth', {
                    writable: true,
                    configurable: true,
                    value: originWidth + offset
                });
                Object.defineProperty(window, 'innerHeight', {
                    writable: true,
                    configurable: true,
                    value: originHeight + offset
                });
                
                window.dispatchEvent(new Event('resize'));
                
                animationRef.current = requestAnimationFrame(animate);
            } else {
                // Final resize to ensure correct state
                window.dispatchEvent(new Event('resize'));
                animationRef.current = null;
            }
        };  
        animate();
    };

    return (
        <LiquidGlass
            displacementScale={60}
            blurAmount={0}
            saturation={120}
            aberrationIntensity={2}
            elasticity={0.1}
            cornerRadius={36}
            padding={isExpanded ? '12px' : '8px'}
            mode='standard'
            overLight={false}
            positioning='top-right'
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

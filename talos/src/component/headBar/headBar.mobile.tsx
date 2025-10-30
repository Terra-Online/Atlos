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

    const toggleExpand = () => {
        setIsExpanded(!isExpanded);
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

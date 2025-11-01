import styles from './headbar.module.scss';
import LiquidGlass from 'liquid-glass-react-positioning';
import React from 'react';

interface HeadBarDesktopProps {
    children: React.ReactNode;
}

const HeadBarDesktop: React.FC<HeadBarDesktopProps> = ({ children }) => {
    return (
        <LiquidGlass
            displacementScale={60}
            blurAmount={0}
            saturation={120}
            aberrationIntensity={2}
            elasticity={0.1}
            cornerRadius={50}
            padding='8px 16px'
            mode='standard'
            overLight={false}
            positioning='top-right'
            style={{
                position: 'fixed',
                top: '1rem',
                right: '1rem',
                backgroundColor: 'var(--headbar-bg)',
                borderRadius: '50%',
            }}
        >
            <div className={styles.headbar}>{children}</div>
        </LiquidGlass>
    );
};

export default HeadBarDesktop;

import styles from './headbar.module.scss';
import React from 'react';

interface HeadBarDesktopFallbackProps {
    children: React.ReactNode;
}

const HeadBarDesktopFallback: React.FC<HeadBarDesktopFallbackProps> = ({ children }) => {
    return (
        <div
            className={styles.headbarFallback}
            style={{
                position: 'fixed',
                top: '1rem',
                right: '1rem',
            }}
        >
            <div className={styles.headbar}>{children}</div>
        </div>
    );
};

export default HeadBarDesktopFallback;
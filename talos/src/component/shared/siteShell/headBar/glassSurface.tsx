import LiquidGlass from 'liquid-glass-react-positioning';
import type { ReactNode } from 'react';
import styles from './headbar.module.scss';

interface Props {
    children: ReactNode;
    mobile?: boolean;
    expanded?: boolean;
    compact?: boolean;
}

export default function GlassSurface({ children, mobile = false, expanded = false, compact = false }: Props) {
    return (
        <div className={styles.glassShell}>
            <LiquidGlass
                className={styles.glassMaterial}
                displacementScale={mobile ? 20 : 60}
                blurAmount={0}
                saturation={mobile ? 20 : 120}
                aberrationIntensity={2}
                elasticity={0.1}
                cornerRadius={mobile ? 36 : 50}
                padding={mobile ? (expanded ? '12px' : '8px') : (compact ? '8px' : '8px 16px')}
                mode='standard'
                overLight={false}
                positioning='top-right'
                style={{
                    position: 'fixed',
                    top: 'max(1rem, env(safe-area-inset-top, 0px))',
                    right: '1rem',
                    borderRadius: mobile ? '36px' : '50px',
                }}
            >
                {children}
            </LiquidGlass>
        </div>
    );
}

import type { CSSProperties } from 'react';
import { LinearBlur } from 'progressive-blur';
import { usePerformanceMode } from '@/store/uiPrefs';
import styles from './AdaptiveLinearBlur.module.scss';

interface AdaptiveLinearBlurProps {
    side: 'top' | 'bottom';
    strength: number;
    falloffPercentage?: number;
    className?: string;
}

const isFirefox = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const userAgent = navigator.userAgent;
    return /Firefox\//i.test(userAgent) && !/Seamonkey\//i.test(userAgent);
};

const AdaptiveLinearBlur = ({
    side,
    strength,
    falloffPercentage,
    className,
}: AdaptiveLinearBlurProps) => {
    const performanceMode = usePerformanceMode();

    if (!performanceMode && !isFirefox()) {
        return (
            <LinearBlur
                side={side}
                strength={strength}
                falloffPercentage={falloffPercentage}
                className={className}
            />
        );
    }

    return (
        <div
            aria-hidden='true'
            data-side={side}
            className={[styles.performanceFade, className]
                .filter(Boolean)
                .join(' ')}
            style={
                {
                    '--scroll-edge-fade-end': `${falloffPercentage ?? 100}%`,
                } as CSSProperties
            }
        />
    );
};

export default AdaptiveLinearBlur;

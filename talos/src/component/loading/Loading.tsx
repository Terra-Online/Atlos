import { useState, useEffect, useRef } from 'react';
import styles from './Loading.module.scss';
import { useDevice } from '@/platform/device';

const Loading = ({
    maxProgress = 50,
    completeController,
}: {
    maxProgress?: number;
    completeController?: () => void;
}) => {
    const { isMobile } = useDevice();
    const [progress, setProgress] = useState(0);
    const [showCompletionEffect, setShowCompletionEffect] = useState(false);
    const completion = useRef(completeController);
    completion.current = completeController;

    useEffect(() => {
        const interval = window.setInterval(() => {
            setProgress((prev) => prev < maxProgress ? prev + 1 : maxProgress);
        }, 30);
        return () => window.clearInterval(interval);
    }, [maxProgress]);

    useEffect(() => {
        if (progress !== 100 || maxProgress !== 100) return undefined;
        let finish: number | undefined;
        // Preserve the old final tick plus 300ms pause, but own one completion
        // sequence instead of scheduling side effects from every state updater.
        const start = window.setTimeout(() => {
            setShowCompletionEffect(true);
            finish = window.setTimeout(() => completion.current?.(), 450);
        }, 330);
        return () => {
            window.clearTimeout(start);
            window.clearTimeout(finish);
        };
    }, [progress, maxProgress]);

    return (
        <div className={styles.loadingContainer}>
            {showCompletionEffect && (
                <div className={styles.completionEffect}></div>
            )}

            <div
                className={`${styles.loadingBar} ${isMobile ? styles.mobile : ''}`}
            >
                <div
                    className={styles.loadingProgress}
                    style={
                        isMobile
                            ? { width: `${progress}%` }
                            : { height: `${progress}%` }
                    }
                >
                    <span className={styles.loadingText}>{progress}%</span>
                </div>
            </div>
        </div>
    );
};

export default Loading;

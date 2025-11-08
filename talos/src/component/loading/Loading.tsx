import { useState, useEffect, useRef } from 'react';
import styles from './Loading.module.scss';
import { useDevice } from '@/utils/device.ts';

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
    const intervalRef = useRef<number | null>(null);

    useEffect(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }

        intervalRef.current = window.setInterval(() => {
            setProgress((prev) => {
                if (prev < maxProgress) {
                    return prev + 1;
                }

                if (maxProgress === 100) {
                    setTimeout(() => {
                        setShowCompletionEffect(true);
                        setTimeout(() => {
                            completeController?.();
                        }, 450); // 与CSS动画持续时间保持一致
                    }, 300);
                }
                return maxProgress;
            });
        }, 30);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [completeController, maxProgress]);

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

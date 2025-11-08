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
    const completionTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }

        intervalRef.current = window.setInterval(() => {
            setProgress((prev) => {
                if (prev >= maxProgress) {
                    // 当进度达到maxProgress时，启动完成效果
                    if (maxProgress === 100 && !showCompletionEffect) {
                        setShowCompletionEffect(true);
                        completionTimeoutRef.current = window.setTimeout(() => {
                            completeController?.();
                        }, 450); // 与CSS动画持续时间保持一致
                    }
                    return maxProgress;
                }
                return prev + 1;
            });
        }, 30);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
            if (completionTimeoutRef.current) {
                clearTimeout(completionTimeoutRef.current);
            }
        };
    }, [completeController, maxProgress]);

    return (
        <div className={styles.loadingContainer}>
            {showCompletionEffect && (
                <div className={styles.completionEffect} />
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
                    <div
                        className={styles.textContainer}
                        style={
                            isMobile
                                ? { left: `${progress}%` } // 横向移动（进度%）
                                : { top: `${progress}%` } // 纵向移动（进度%）
                        }
                    >
                        <div className={styles.loadingText}>{progress}%</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Loading;

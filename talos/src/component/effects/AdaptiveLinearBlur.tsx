import { useEffect, useRef, type RefObject } from 'react';
import { LinearBlur } from 'progressive-blur';
import { usePerformanceMode } from '@/store/uiPrefs';
import styles from './AdaptiveLinearBlur.module.scss';

interface AdaptiveLinearBlurProps {
    side: 'top' | 'bottom';
    targetRef: RefObject<HTMLElement | null>;
    visible?: boolean;
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
    targetRef,
    visible = true,
    strength,
    falloffPercentage,
    className,
}: AdaptiveLinearBlurProps) => {
    const performanceMode = usePerformanceMode();
    const mask = performanceMode || isFirefox();
    const fadeRef = useRef<HTMLDivElement>(null);
    const visibleRef = useRef(visible);
    const updateRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        const target = targetRef.current;
        const fade = fadeRef.current;
        if (!mask || !target || !fade) return;
        const property = `--scroll-fade-${side}`;
        let animation: Animation | undefined;
        let height = -1;
        const updateClass = () =>
            target.classList.toggle(
                styles.maskTarget,
                ['top', 'bottom'].some(
                    (edge) =>
                        parseFloat(
                            getComputedStyle(target).getPropertyValue(
                                `--scroll-fade-${edge}`,
                            ),
                        ) > 0,
                ),
            );
        const update = () => {
            const next = visibleRef.current
                ? (fade.offsetHeight * (falloffPercentage ?? 100)) / 100
                : 0;
            if (height === next) return;
            height = next;
            const current =
                getComputedStyle(target).getPropertyValue(property) || '0px';
            animation?.cancel();
            target.style.setProperty(property, `${next}px`);
            if (
                typeof target.animate === 'function' &&
                parseFloat(current) !== next
            ) {
                target.classList.add(styles.maskTarget);
                animation = target.animate(
                    [{ [property]: current }, { [property]: `${next}px` }],
                    {
                        duration: 250,
                        easing: 'ease-out',
                    },
                );
                animation.onfinish = () => {
                    animation = undefined;
                    updateClass();
                };
            } else updateClass();
        };
        updateRef.current = update;
        // Mask the scroll viewport itself so its real background shows through.
        // The transparent marker retains each caller's existing fade dimensions.
        update();
        const observer = new ResizeObserver(update);
        observer.observe(fade);
        return () => {
            observer.disconnect();
            animation?.cancel();
            updateRef.current = null;
            target.style.removeProperty(property);
            updateClass();
        };
    }, [mask, targetRef, side, falloffPercentage]);

    useEffect(() => {
        visibleRef.current = visible;
        updateRef.current?.();
    }, [visible]);

    if (!mask) {
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
            ref={fadeRef}
            aria-hidden='true'
            data-side={side}
            className={[styles.performanceFade, className]
                .filter(Boolean)
                .join(' ')}
        />
    );
};

export default AdaptiveLinearBlur;

import classNames from 'classnames';
import { getItemIconUrl } from '@/utils/resource.ts';
import { useFilter, useSwitchFilter } from '@/store/marker.ts';
import styles from './filterList.module.scss';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue } from 'motion/react';

const FilterListDesktop = ({ isSidebarOpen }: { isSidebarOpen: boolean }) => {
    const filterList = useFilter();
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [showLeftMask, setShowLeftMask] = useState(false);
    const [showRightMask, setShowRightMask] = useState(false);
    const [maxScroll, setMaxScroll] = useState(0);
    const x = useMotionValue(0);

    const maxDisplayItems = 8;
    const shouldShowEighthHalf = filterList.length >= maxDisplayItems;

    const getContainerWidth = () => {
        const itemCount = Math.min(filterList.length, maxDisplayItems);
        if (itemCount === 0) return 0;
        if (itemCount <= 7) {
            return itemCount * 44 + 16; // 每个item约44px（包含gap），加上padding
        } else {
            return 7 * 44 + 32 + 16; // 7个完整 + 半个 + padding
        }
    };

    useLayoutEffect(() => {
        const container = containerRef.current;
        const content = contentRef.current;
        if (!container || !content) return;

        const measure = () => {
            const containerW = container.clientWidth;
            const contentW = content.scrollWidth;
            const nextMax = Math.max(contentW - containerW + 14, 0);
            setMaxScroll(nextMax);

            const currentX = x.get();
            const clampedX = Math.max(-nextMax, Math.min(0, currentX));
            if (clampedX !== currentX) x.set(clampedX);
        };

        measure();
        const ro = new ResizeObserver(() => measure());
        ro.observe(container);
        ro.observe(content);
        const imgs = content.querySelectorAll('img');
        let pending = imgs.length;
        if (pending > 0) {
            imgs.forEach((img) => {
                if (img.complete) {
                    pending -= 1;
                    if (pending === 0) measure();
                } else {
                    img.addEventListener('load', measure, { once: true });
                    img.addEventListener('error', measure, { once: true });
                }
            });
        }
        return () => ro.disconnect();
    }, [filterList, x]);

    useEffect(() => {
        const unsub = x.on('change', (v) => {
            if (maxScroll <= 0) {
                setShowLeftMask(false);
                setShowRightMask(false);
                return;
            }
            setShowLeftMask(v < -1);
            setShowRightMask(v > -maxScroll + 1);
        });
        return () => unsub();
    }, [x, maxScroll]);

    useEffect(() => {
        const v = x.get();
        if (maxScroll <= 0) {
            setShowLeftMask(false);
            setShowRightMask(false);
        } else {
            setShowLeftMask(v < -1);
            setShowRightMask(v > -maxScroll + 1);
        }
    }, [maxScroll, x]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (maxScroll <= 0) return;
            e.preventDefault();
            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            const next = Math.max(-maxScroll, Math.min(0, x.get() - delta));
            x.set(next);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [x, maxScroll]);

    const switchFilter = useSwitchFilter();

    return (
        <div
            className={classNames(styles.mainFilterList, {
                [styles.hidden]: filterList.length === 0,
                [styles.sidebarOpen]: isSidebarOpen,
            })}
            style={{ width: `${getContainerWidth()}px` }}
        >
            <div
                ref={containerRef}
                className={classNames(styles.mainFilterContentContainer, {
                    [styles.leftMaskOpacity]: showLeftMask,
                    [styles.rightMaskOpacity]: showRightMask,
                })}
            >
                <motion.div
                    ref={contentRef}
                    className={styles.innerContainer}
                    style={{ x }}
                    drag={maxScroll > 0 ? 'x' : false}
                    dragConstraints={{ left: -maxScroll, right: 0 }}
                    dragElastic={0.18}
                    dragMomentum={true}
                    dragTransition={{ power: 0.2, bounceStiffness: 320, bounceDamping: 22 }}
                >
                    <AnimatePresence>
                        {[...filterList].reverse().map((item, index) => (
                            <motion.span
                                key={item}
                                className={classNames(
                                    styles.mainFilterContentItem,
                                    {
                                        [styles.halfVisible]:
                                            index === 7 && shouldShowEighthHalf,
                                    },
                                )}
                                style={{ backgroundImage: `url(${getItemIconUrl(item)})` }}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.3 }}
                                onClick={() => {
                                    switchFilter(item);
                                }}
                            />
                        ))}
                    </AnimatePresence>
                </motion.div>
            </div>
        </div>
    );
};

export default FilterListDesktop;

import classNames from 'classnames';
import { getItemIconUrl } from '@/utils/resource.ts';
import { useFilter, useSwitchFilter } from '@/store/marker.ts';
import styles from './filterList.module.scss';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue } from 'motion/react';

const FilterList = ({ isSidebarOpen }: { isSidebarOpen: boolean }) => {
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

    // 1) 计算内容宽度与容器宽度，得到最大可滚动距离
    useLayoutEffect(() => {
        const container = containerRef.current;
        const content = contentRef.current;
        if (!container || !content) return;

        const measure = () => {
            const containerW = container.clientWidth;
            const contentW = content.scrollWidth;
            const nextMax = Math.max(contentW - containerW + 14, 0);
            setMaxScroll(nextMax);

            // 保留当前滚动位置，只在越界时修正
            const currentX = x.get();
            const clampedX = Math.max(-nextMax, Math.min(0, currentX));
            if (clampedX !== currentX) {
                x.set(clampedX);
            }
        };

        // 首次测量
        measure();

        // 监听尺寸变化
        const ro = new ResizeObserver(() => measure());
        ro.observe(container);
        ro.observe(content);

        // 图片加载完可能改变宽度
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

        return () => {
            ro.disconnect();
        };
    }, [filterList, x]);

    // 2) 根据 x 的值更新左右遮罩
    useEffect(() => {
        const unsub = x.on('change', (v) => {
            if (maxScroll <= 0) {
                setShowLeftMask(false);
                setShowRightMask(false);
                return;
            }
            // v 在 [ -maxScroll, 0 ] 区间
            setShowLeftMask(v < -1); // 离开左侧就显示左遮罩
            setShowRightMask(v > -maxScroll + 1); // 未到最右显示右遮罩
        });
        return () => unsub();
    }, [x, maxScroll]);

    // 当 maxScroll 变化时，按当前 x 初始化遮罩
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

    // 3) 处理滚轮 -> 修改 x（阻止默认滚动）
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (maxScroll <= 0) return; // 无溢出不处理
            e.preventDefault();
            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            // 向下/右滚动 => 内容左移 => x 变小
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
                            <motion.img
                                key={item}
                                className={classNames(
                                    styles.mainFilterContentItem,
                                    {
                                        [styles.halfVisible]:
                                            index === 7 && shouldShowEighthHalf,
                                    },
                                )}
                                src={getItemIconUrl(item)}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.3 }}
                                onClick={() => {
                                    switchFilter(item);
                                }}
                                draggable='false' // Prevent image dragging
                            />
                        ))}
                    </AnimatePresence>
                </motion.div>
            </div>
        </div>
    );
};

export default FilterList;
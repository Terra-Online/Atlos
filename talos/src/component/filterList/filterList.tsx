import classNames from 'classnames';
import { getItemIconUrl } from '@/utils/resource.ts';
import { useFilter, useSwitchFilter } from '@/store/marker.ts';
import styles from './filterList.module.scss';
import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

const FilterList = ({ isSidebarOpen }: { isSidebarOpen: boolean }) => {
    const filterList = useFilter();
    const containerRef = useRef<HTMLDivElement>(null);
    const [showLeftMask, setShowLeftMask] = useState(false);
    const [showRightMask, setShowRightMask] = useState(false);

    // 计算显示相关参数
    const maxDisplayItems = 8;
    const shouldShowEighthHalf = filterList.length >= maxDisplayItems;

    // 简单的宽度计算，只用于动画过渡
    const getContainerWidth = () => {
        const itemCount = Math.min(filterList.length, maxDisplayItems);
        if (itemCount === 0) return 0;
        if (itemCount <= 7) {
            return itemCount * 48 + 16; // 每个item约48px（包含gap），加上padding
        } else {
            return 7 * 48 + 24 + 16; // 7个完整 + 半个 + padding
        }
    };

    const checkScroll = () => {
        const container = containerRef.current;
        if (!container) return;

        const { scrollLeft, scrollWidth, clientWidth } = container;
        setShowLeftMask(scrollLeft > 0);
        setShowRightMask(scrollLeft < scrollWidth - clientWidth);
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e: globalThis.WheelEvent) => {
            e.preventDefault();
            container.scrollLeft += e.deltaY;
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        container.addEventListener('scroll', checkScroll);

        // 初始化检查
        checkScroll();

        return () => {
            container.removeEventListener('wheel', handleWheel);
            container.removeEventListener('scroll', checkScroll);
        };
    }, []);

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
                    [styles.rightMaskOpacity]:
                        showRightMask || shouldShowEighthHalf, // 当有8个或更多物品时总是显示右侧mask
                })}
            >
                <div className={styles.innerContainer}>
                    <AnimatePresence>
                        {filterList.map((item, index) => (
                            <motion.img
                                key={item}
                                className={classNames(
                                    styles.mainFilterContentItem,
                                    {
                                        [styles.halfVisible]:
                                            index === 7 && shouldShowEighthHalf, // 第8个物品在有8个或更多时半显示
                                    },
                                )}
                                src={getItemIconUrl(item)}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.3 }}
                                onClick={() => {
                                    switchFilter(item);
                                }}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
};

export default FilterList;

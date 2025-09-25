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

    const maxDisplayItems = 8;
    const shouldShowEighthHalf = filterList.length >= maxDisplayItems;

    const getContainerWidth = () => {
        const itemCount = Math.min(filterList.length, maxDisplayItems);
        if (itemCount === 0) return 0;
        if (itemCount <= 7) {
            return itemCount * 44 + 16; // 每个item约48px（包含gap），加上padding
        } else {
            return 7 * 48 + 24 + 16; // 7个完整 + 半个 + padding
        }
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const checkScroll = () => {
            if (!container) return;
            const { scrollLeft, scrollWidth, clientWidth } = container;
            const isScrolledToStart = scrollLeft <= 0;

            setShowLeftMask(!isScrolledToStart);

            // 只有内容溢出时才显示右遮罩
            if (filterList.length <= 7) {
                setShowRightMask(false);
            } else {
                const isScrolledToEnd = scrollLeft >= scrollWidth - clientWidth - 1;
                setShowRightMask(!isScrolledToEnd);
            }
        };

        let isDragging = false;
        let startX: number;
        let startScroll: number;

        const handleMouseDown = (e: MouseEvent) => {
            isDragging = true;
            startX = e.pageX;
            startScroll = container.scrollLeft;
            container.style.cursor = 'grabbing';
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            e.preventDefault();
            const walk = e.pageX - startX;
            container.scrollLeft = startScroll - walk;
        };

        const handleMouseUp = () => {
            isDragging = false;
            container.style.cursor = 'grab';
        };

        const handleMouseLeave = () => {
            if (isDragging) {
                isDragging = false;
                container.style.cursor = 'grab';
            }
        };

        const handleWheel = (e: globalThis.WheelEvent) => {
            e.preventDefault();
            container.scrollLeft += e.deltaY;
        };

        container.addEventListener('mousedown', handleMouseDown);
        container.addEventListener('mousemove', handleMouseMove);
        container.addEventListener('mouseup', handleMouseUp);
        container.addEventListener('mouseleave', handleMouseLeave);
        container.addEventListener('wheel', handleWheel, { passive: false });
        container.addEventListener('scroll', checkScroll);

        // Initial check
        checkScroll();

        // Re-check when filterList changes
        const observer = new MutationObserver(checkScroll);
        observer.observe(container, { childList: true, subtree: true });

        return () => {
            container.removeEventListener('mousedown', handleMouseDown);
            container.removeEventListener('mousemove', handleMouseMove);
            container.removeEventListener('mouseup', handleMouseUp);
            container.removeEventListener('mouseleave', handleMouseLeave);
            container.removeEventListener('wheel', handleWheel);
            container.removeEventListener('scroll', checkScroll);
            observer.disconnect();
        };
    }, [filterList]);

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
                    [styles.rightMaskOpacity]: showRightMask, // rely on showRightMask
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
                </div>
            </div>
        </div>
    );
};

export default FilterList;

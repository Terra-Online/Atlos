import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DefaultFilterIcon from '../../assets/logos/filter.svg?react';
import styles from './markFilter.module.scss';
import { MarkVisibilityContext } from './visibilityContext';
import { useTranslateUI } from '@/locale';
import { useMarkFilterExpanded, useToggleMarkFilterExpanded } from '@/store/uiPrefs';
import { motion, useMotionValue, useDragControls } from 'motion/react';
import { animate } from 'motion';
import { useMarkFilterDragContext } from './reorderCore';

interface MarkFilterProps {
    icon?: React.FC<React.SVGProps<SVGSVGElement>> | (() => React.ReactNode);
    title?: string;
    children: React.ReactNode;
    empty?: React.ReactNode;
    // stable id for persisting expanded state
    idKey: string;
}

const MarkFilter = ({
    icon: CustomIcon,
    title,
    children,
    empty,
    idKey,
}: MarkFilterProps) => {
    const t = useTranslateUI();
    const isExpanded = useMarkFilterExpanded(idKey);
    const toggleExpandByKey = useToggleMarkFilterExpanded();
    const dragControls = useDragControls();
    const { register, unregister, startDrag, updateDrag, endDrag, orderOf, isDragging, draggingId } = useMarkFilterDragContext();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const y = useMotionValue(0);

    const isSelfDragging = draggingId === idKey;
    const orderIndex = orderOf(idKey);

    // prevent header click toggle when a drag occurred
    const didDragRef = useRef(false);
    const toggleExpand = () => {
        if (didDragRef.current) return;
        toggleExpandByKey(idKey);
    };

    // visibility state reported by children
    const [visibleMap, setVisibleMap] = useState<Set<string>>(new Set());
    const report = useCallback((id: string, visible: boolean) => {
        setVisibleMap((prev) => {
            const has = prev.has(id);
            if (visible === has) return prev;
            const next = new Set(prev);
            if (visible) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    const visibleCount = visibleMap.size;

    const isEmpty = useMemo(() => visibleCount === 0, [visibleCount]);

    const contextValue = useMemo(() => ({ report }), [report]);

    // lazy render: only render children when expanded or after first expansion
    const [hasEverExpanded, setHasEverExpanded] = useState(() => isExpanded);
    
    useEffect(() => {
        if (isExpanded && !hasEverExpanded) {
            setHasEverExpanded(true);
        }
    }, [isExpanded, hasEverExpanded]);

    // register for reorder measurements
    useEffect(() => {
        const getLayout = () => {
            const r = containerRef.current?.getBoundingClientRect();
            const top = r?.top ?? 0;
            const height = r?.height ?? 0;
            const center = top + height / 2;
            return { top, height, bottom: top + height, center };
        };
        register?.(idKey, getLayout);
        return () => unregister?.(idKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idKey]);

    const onDragStart = () => {
        didDragRef.current = true;
        startDrag?.(idKey);
    };
    const onDrag = () => {
        updateDrag?.(idKey, y.get());
    };
    const onDragEnd = () => {
        // animate back translation; flex order will finalize position
        animate(y, 0, { type: 'spring', stiffness: 700, damping: 40 });
        endDrag?.();
        // reset drag guard after a tick to allow next click
        setTimeout(() => {
            didDragRef.current = false;
        }, 0);
    };

    const scale = isDragging && !isSelfDragging ? 0.98 : 1;

    return (
    <MarkVisibilityContext.Provider value={contextValue}>
    <motion.div
            ref={containerRef}
            className={`${styles.markFilterContainer} ${isSelfDragging ? styles.dragging : ''}`}
            layout
        style={{ y, zIndex: isSelfDragging ? 1000 : 1, order: orderIndex + 1, touchAction: isSelfDragging ? 'none' : 'auto' }}
            drag="y"
            dragControls={dragControls}
        dragListener={false}
            dragElastic={0.05}
            dragMomentum={false}
            onDragStart={onDragStart}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
            animate={{ scale }}
            transition={{
                layout: { type: 'spring', stiffness: 500, damping: 40 },
                scale: { duration: 0.15 },
                y: { type: 'spring', stiffness: 700, damping: 40 },
            }}
        >
            <div
                className={`${styles.filterHeader} ${isExpanded ? styles.expanded : ''}`}
                onClick={toggleExpand}
                onPointerDown={(e) => {
                    // start drag from header only; allow scrolling elsewhere
                    dragControls.start(e);
                }}
                style={{ cursor: isSelfDragging ? 'grabbing' : 'grab' }}
            >
                <div className={styles.filterIcon}>
                    {CustomIcon ? (
                        typeof CustomIcon === 'function' ? (
                            <CustomIcon className={styles.icon} />
                        ) : (
                            CustomIcon
                        )
                    ) : (
                        <DefaultFilterIcon className={styles.icon} />
                    )}
                </div>
                <div className={styles.filterTitle}>{title ?? t('markFilter.title')}</div>
                <div className={styles.toggleIcon}>
                    <svg
                        viewBox='0 0 24 24'
                        className={isExpanded ? styles.expanded : ''}
                    >
                        <path d='M0,10.3923L18,0v20.7846L0,10.3923Z' />
                    </svg>
                </div>
            </div>

            <div className={`${styles.filterContent} ${isExpanded ? styles.expanded : ''}`}>
                <div className={`${styles.contentInner} ${isExpanded ? styles.visible : ''}`}>
                    {hasEverExpanded && (
                        <>
                            {children}
                            {isEmpty && (
                                empty ?? (
                                    <div className={`${styles.placeholderContent} ${styles.markEmpty}`}>
                                        <p>{t('markFilter.emptyTitle')}</p>
                                        <p>{t('markFilter.emptyDesc')}</p>
                                    </div>
                                )
                            )}
                        </>
                    )}
                </div>
            </div>
        </motion.div>
        </MarkVisibilityContext.Provider>
    );
};

export default MarkFilter;
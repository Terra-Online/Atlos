import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DefaultFilterIcon from '../../assets/logos/filter.svg?react';
import styles from './markFilter.module.scss';
import { MarkVisibilityContext } from './visibilityContext';
import { useTranslateUI } from '@/locale';
import { useMarkFilterExpanded, useToggleMarkFilterExpanded, useLayoutVersion } from '@/store/uiPrefs';
import { motion, useMotionValue, useDragControls } from 'motion/react';
import { animate } from 'motion';
import { useMarkFilterDragContext } from './reorderCore';

interface MarkFilterProps {
    icon?: React.FC<React.SVGProps<SVGSVGElement>> | (() => React.ReactNode);
    title?: string;
    titleSuffix?: React.ReactNode;
    children: React.ReactNode;
    empty?: React.ReactNode;
    // stable id for persisting expanded state
    idKey: string;
    // optional data attribute for visual styling
    dataCategory?: string;
    columns?: 2 | 3 | 4;
    binderMode?: boolean;
    // Pre-computed from parent so initial render has the correct empty state (prevents CLS)
    initialEmpty?: boolean;
    variant?: 'versionNew';
    reorderable?: boolean;
}

const MarkFilter = ({
    icon: CustomIcon,
    title,
    titleSuffix,
    children,
    empty,
    idKey,
    dataCategory,
    columns = 2,
    binderMode = false,
    initialEmpty = false,
    variant,
    reorderable = true,
}: MarkFilterProps) => {
    const t = useTranslateUI();
    const isExpanded = useMarkFilterExpanded(idKey);
    const layoutVersion = useLayoutVersion();
    const toggleExpandByKey = useToggleMarkFilterExpanded();
    const dragControls = useDragControls();
    const { register, unregister, startDrag, updateDrag, endDrag, orderOf, isDragging, draggingId } = useMarkFilterDragContext();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const y = useMotionValue(0);

    const isSelfDragging = draggingId === idKey;
    const orderIndex = orderOf(idKey);

    // prevent header click toggle when a drag occurred
    const didDragRef = useRef(false);

    // visibility state reported by children
    const [hasReceivedFirstReport, setHasReceivedFirstReport] = useState(false);
    const visibleIds = useRef(new Set<string>());
    const [visibleCount, setVisibleCount] = useState(0);
    const visibilityQueued = useRef(false);
    const visibilityAlive = useRef(true);
    useEffect(() => { visibilityAlive.current = true; return () => { visibilityAlive.current = false; }; }, []);
    const report = useCallback((id: string, visible: boolean) => {
        if (visible) visibleIds.current.add(id); else visibleIds.current.delete(id);
        if (visibilityQueued.current) return;
        visibilityQueued.current = true;
        queueMicrotask(() => {
            visibilityQueued.current = false;
            if (!visibilityAlive.current) return;
            setHasReceivedFirstReport(true);
            setVisibleCount(visibleIds.current.size);
        });
    }, []);

    // Use pre-computed initialEmpty before any child has reported; switch to live data after.
    // This ensures CSS order is correct on the very first render, preventing CLS.
    const isEmpty = hasReceivedFirstReport ? visibleCount === 0 : initialEmpty;

    // Auto-collapse only on transitions (empty→non-empty and vice versa).
    // Initialized from pre-computed value so no state change is needed on first render.
    const [autoCollapsed, setAutoCollapsed] = useState(initialEmpty);
    const prevIsEmptyRef = useRef(initialEmpty);
    useEffect(() => {
        const prev = prevIsEmptyRef.current;
        prevIsEmptyRef.current = isEmpty;
        if (!prev && isEmpty) setAutoCollapsed(true);
        if (prev && !isEmpty) setAutoCollapsed(false);
    }, [isEmpty]);

    // Effective expanded state: respect user pref only when filter is non-empty
    const effectiveExpanded = isExpanded && !autoCollapsed;

    // User can explicitly expand an auto-collapsed (empty) filter
    const toggleExpand = () => {
        if (didDragRef.current) return;
        if (autoCollapsed) {
            setAutoCollapsed(false);
            if (!isExpanded) toggleExpandByKey(idKey);
            return;
        }
        toggleExpandByKey(idKey);
    };

    const contextValue = useMemo(() => ({ report }), [report]);

    // lazy render: don't render children of auto-collapsed empty filters until first explicit expand
    const [hasEverExpanded, setHasEverExpanded] = useState(() => isExpanded && !initialEmpty);
    const [isMounted, setIsMounted] = useState(false);
    // Suppress layout animation during initial hydration/registration phase to prevent CLS.
    // Double-rAF ensures all initial register() effects have settled before spring is enabled.
    const [layoutAnimReady, setLayoutAnimReady] = useState(false);

    useEffect(() => {
        setIsMounted(true);
        let raf1 = 0, raf2 = 0;
        raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => setLayoutAnimReady(true));
        });
        return () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
        };
    }, []);
    
    useEffect(() => {
        if (effectiveExpanded && !hasEverExpanded) {
            setHasEverExpanded(true);
        }
    }, [effectiveExpanded, hasEverExpanded]);

    const shouldRenderChildren = hasEverExpanded || binderMode;

    // register for reorder measurements
    useEffect(() => {
        if (!reorderable) return undefined;
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
    }, [idKey, reorderable]);

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
    const contentColumnsStyle = binderMode
        ? undefined
        : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };
    const containerClassName = [
        styles.markFilterContainer,
        variant ? styles[variant] : '',
        isSelfDragging ? styles.dragging : '',
    ].filter(Boolean).join(' ');

    return (
    <MarkVisibilityContext.Provider value={contextValue}>
    <motion.div
            ref={containerRef}
            data-category={dataCategory} // Added data-category attribute for UserGuide selection
            data-filter-variant={variant}
            className={containerClassName}
            layout
            layoutDependency={`${effectiveExpanded}:${isEmpty}:${orderIndex}:${visibleCount}:${columns}:${binderMode}:${reorderable}:${variant}:${title}:${layoutVersion}`}
            style={{ y, zIndex: isSelfDragging ? 1000 : 1, order: reorderable ? (isEmpty ? 1001 : 1) + orderIndex : -1, touchAction: 'pan-y' }}
            drag={isMounted && reorderable ? "y" : false}
            dragControls={isMounted && reorderable ? dragControls : undefined}
            dragListener={false}
            dragElastic={0.05}
            dragMomentum={false}
            onDragStart={onDragStart}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
            animate={{ scale }}
            transition={{
                layout: layoutAnimReady
                    ? { type: 'spring', stiffness: 500, damping: 40 }
                    : { duration: 0 },
                scale: { duration: 0.15 },
                y: { type: 'spring', stiffness: 700, damping: 40 },
            }}
        >
        <div
                className={`${styles.filterHeader} ${effectiveExpanded ? styles.expanded : ''}`}
                data-filter-header="true"
                onClick={toggleExpand}
            >
                <div 
                    className={styles.filterIcon}
                    data-drag-handle="true"
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        if (isMounted && reorderable) dragControls.start(e);
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                    }}
                    style={{ cursor: reorderable ? (isSelfDragging ? 'grabbing' : 'grab') : 'default', touchAction: 'none' }}
                >
                    {CustomIcon ? (
                        typeof CustomIcon === 'function' ? (
                            <CustomIcon className={styles.icon} data-ctgr={dataCategory}/>
                        ) : (
                            CustomIcon
                        )
                    ) : (
                        <DefaultFilterIcon className={styles.icon} data-ctgr={dataCategory}/>
                    )}
                </div>
                <div className={styles.filterTitle}>
                    <span>{title ?? t('markFilter.title')}</span>
                    {titleSuffix}
                </div>
                <div className={styles.toggleIcon}>
                    <svg
                        viewBox='0 0 24 24'
                        className={effectiveExpanded ? styles.expanded : ''}
                    >
                        <path d='M0,10.3923L18,0v20.7846L0,10.3923Z' />
                    </svg>
                </div>
            </div>

            <div
                className={`${styles.filterContent} ${effectiveExpanded ? styles.expanded : ''}`}
                data-filter-content="true"
                data-expanded={effectiveExpanded ? 'true' : 'false'}
            >
                <div
                    className={`${styles.contentInner} ${effectiveExpanded ? styles.visible : ''} ${binderMode ? styles.binderLayout : ''}`}
                    style={contentColumnsStyle}
                >
                    {shouldRenderChildren && (
                        <>
                            {children}
                            {isEmpty && (
                                empty ?? (
                                    <div className={`${styles.placeholderContent} ${styles.markEmpty}`}>
                                        <p>{t('markFilter.emptyTitle')}</p>
                                        <p dangerouslySetInnerHTML={{ __html: String(t('markFilter.emptyDesc')) }} />
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

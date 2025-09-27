import React, { useCallback, useMemo, useRef, useState } from 'react';
import DefaultFilterIcon from '../../asset/logos/filter.svg?react';
import styles from './markFilter.module.scss';
import { MarkVisibilityContext } from './visibilityContext';

interface MarkFilterProps {
    icon?: React.FC<React.SVGProps<SVGSVGElement>> | (() => React.ReactNode);
    title?: string;
    children: React.ReactNode;
}

const MarkFilter = ({
    icon: CustomIcon,
    title = 'Filter Options',
    children,
}: MarkFilterProps) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const contentRef = useRef(null);

    const toggleExpand = () => {
        setIsExpanded(!isExpanded);
    };

    // visibility state reported by children
    const [visibleMap, setVisibleMap] = useState<Set<string>>(new Set());
    const report = useCallback((id: string, visible: boolean) => {
        setVisibleMap((prev) => {
            const has = prev.has(id);
            // 如果状态未变化，不要创建新 Set，避免不必要的重渲染
            if (visible === has) return prev;
            const next = new Set(prev);
            if (visible) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    const visibleCount = visibleMap.size;
    const isEmpty = useMemo(() => {
        // children 为空或可见项目为 0，则判定为空过滤器
        if (!children) return true;
        return visibleCount === 0;
    }, [children, visibleCount]);

    const contextValue = useMemo(() => ({ report }), [report]);
    return (
    <MarkVisibilityContext.Provider value={contextValue}>
    <div className={styles.markFilterContainer}>
            <div
                className={`${styles.filterHeader} ${isExpanded ? styles.expanded : ''}`}
                onClick={toggleExpand}
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
                <div className={styles.filterTitle}>{title}</div>
                <div className={styles.toggleIcon}>
                    <svg
                        viewBox='0 0 24 24'
                        className={isExpanded ? styles.expanded : ''}
                    >
                        <path d='M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z' />
                    </svg>
                </div>
            </div>

            <div
                ref={contentRef}
                className={`${styles.filterContent} ${isExpanded ? styles.expanded : ''}`}
            >
                <div className={`${styles.contentInner} ${isExpanded ? styles.visible : ''}`}>
                    {children}
                    <div
                        className={`${styles.placeholderContent} ${styles.markEmpty}`}
                        style={{ display: isEmpty ? 'block' : 'none' }}
                    >
                        <p>无满足条件的筛选项。</p>
                        <p>请联系管理员。</p>
                    </div>
                </div>
            </div>
        </div>
        </MarkVisibilityContext.Provider>
    );
};

export default MarkFilter;

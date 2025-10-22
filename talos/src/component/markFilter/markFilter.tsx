import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DefaultFilterIcon from '../../assets/logos/filter.svg?react';
import styles from './markFilter.module.scss';
import { MarkVisibilityContext } from './visibilityContext';
import { useTranslateUI } from '@/locale';

interface MarkFilterProps {
    icon?: React.FC<React.SVGProps<SVGSVGElement>> | (() => React.ReactNode);
    title?: string;
    children: React.ReactNode;
    empty?: React.ReactNode;
}

const MarkFilter = ({
    icon: CustomIcon,
    title,
    children,
    empty,
}: MarkFilterProps) => {
    const t = useTranslateUI();
    const [isExpanded, setIsExpanded] = useState(false);

    const toggleExpand = () => {
        setIsExpanded(!isExpanded);
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
    const [hasEverExpanded, setHasEverExpanded] = useState(false);
    
    useEffect(() => {
        if (isExpanded && !hasEverExpanded) {
            setHasEverExpanded(true);
        }
    }, [isExpanded, hasEverExpanded]);

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
        </div>
        </MarkVisibilityContext.Provider>
    );
};

export default MarkFilter;
import React, { useState, useRef } from 'react';
import DefaultFilterIcon from '../../asset/logos/filter.svg?react';
import styles from './markFilter.module.scss';

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

    return (
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
                <div
                    className={`${styles.contentInner} ${isExpanded ? styles.visible : ''}`}
                >
                    {children || (
                        <div className={styles.placeholderContent}>
                            <p>我能夠吞下玻璃而不受損傷。</p>
                            <p>The quick brown fox jumps over the lazy dog.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MarkFilter;

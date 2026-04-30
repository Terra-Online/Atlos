import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import styles from './TabView.module.scss';

export interface TabViewItem {
    key: string;
    label: React.ReactNode;
    description?: React.ReactNode;
}

interface TabViewProps {
    items: TabViewItem[];
    activeKey: string;
    onChange: (key: string) => void;
    fill?: boolean;
    className?: string;
}

const TabView: React.FC<TabViewProps> = ({
    items,
    activeKey,
    onChange,
    fill = false,
    className,
}) => {
    const [indicatorLeft, setIndicatorLeft] = useState<number | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const tabBarRef = useRef<HTMLDivElement | null>(null);
    const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const activeItem = items.find((item) => item.key === activeKey);

    const updateIndicator = useCallback(() => {
        const activeTab = tabRefs.current.get(activeKey);
        const wrapper = wrapperRef.current;
        if (!activeTab || !wrapper) {
            setIndicatorLeft(null);
            return;
        }

        const tabRect = activeTab.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        setIndicatorLeft(tabRect.left - wrapperRect.left + tabRect.width / 2);
    }, [activeKey]);

    useEffect(() => {
        if (items.length === 0) {
            setIndicatorLeft(null);
            return;
        }

        const tabBar = tabBarRef.current;
        if (!tabBar) return;

        const rafId = requestAnimationFrame(updateIndicator);
        const handleResize = () => updateIndicator();
        const handleScroll = () => updateIndicator();

        window.addEventListener('resize', handleResize);
        tabBar.addEventListener('scroll', handleScroll, { passive: true });

        const resizeObserver = new ResizeObserver(() => updateIndicator());
        resizeObserver.observe(tabBar);

        const activeTab = tabRefs.current.get(activeKey);
        if (activeTab) {
            resizeObserver.observe(activeTab);
        }

        return () => {
            cancelAnimationFrame(rafId);
            window.removeEventListener('resize', handleResize);
            tabBar.removeEventListener('scroll', handleScroll);
            resizeObserver.disconnect();
        };
    }, [activeKey, items.length, updateIndicator]);

    return (
        <div className={classNames(styles.tabBarWrapper, className)} ref={wrapperRef}>
            <div className={styles.tabBar} role="tablist" ref={tabBarRef} data-fill={fill ? 'true' : 'false'}>
                {items.map((item) => (
                    <button
                        key={item.key}
                        role="tab"
                        aria-selected={activeKey === item.key}
                        ref={(el) => {
                            if (el) tabRefs.current.set(item.key, el);
                            else tabRefs.current.delete(item.key);
                        }}
                        className={classNames(styles.tab, activeKey === item.key && styles.activeTab)}
                        onClick={() => onChange(item.key)}
                        type="button"
                    >
                        {item.label}
                    </button>
                ))}
                {indicatorLeft !== null && (
                <div
                    className={styles.tabIndicator}
                    style={{ left: `${indicatorLeft}px` }}
                />
            )}
            </div>
            {activeItem?.description ? (
                <div className={styles.description}>{activeItem.description}</div>
            ) : null}
        </div>
    );
};

export default React.memo(TabView);

import { memo, useCallback, useRef, type CSSProperties, type ReactNode, type Ref, type RefObject } from 'react';
import classNames from 'classnames';
import PopoverTooltip from '@/component/popover/popover';
import styles from './TabView.module.scss';
import { useTabIndicator } from './useTabIndicator';

export interface TabViewItem {
    key: string;
    label: ReactNode;
    icon?: ReactNode;
    description?: ReactNode;
    disabled?: boolean;
}

interface QuickAction {
    icon: ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
}

interface Props {
    items: TabViewItem[];
    activeKey: string;
    onChange: (key: string) => void;
    appearance?: 'strip' | 'panel';
    fill?: boolean;
    className?: string;
    ariaLabel?: string;
    quickAction?: QuickAction;
    swipeTargetRef?: RefObject<HTMLElement | null>;
    ref?: Ref<HTMLDivElement>;
}

function TabView({
    items,
    activeKey,
    onChange,
    appearance = 'strip',
    fill = false,
    className,
    ariaLabel,
    quickAction,
    swipeTargetRef,
    ref,
}: Props) {
    const barRef = useRef<HTMLDivElement | null>(null);
    const indicatorRef = useRef<HTMLSpanElement | null>(null);
    const activeItem = items.find((item) => item.key === activeKey);
    const panel = appearance === 'panel';
    const setBar = useCallback((element: HTMLDivElement | null) => {
        barRef.current = element;
        if (typeof ref === 'function') {
            const cleanup = ref(element);
            if (cleanup) return () => { barRef.current = null; cleanup(); };
        } else if (ref) ref.current = element;
        return undefined;
    }, [ref]);
    const layout = JSON.stringify([appearance, ...items.map((item) => item.key)]);
    useTabIndicator(barRef, indicatorRef, layout, activeKey, onChange, swipeTargetRef);

    if (items.length === 0) return null;

    const bar = (
        <div
            className={classNames(styles.tabBar, panel && styles.panel, panel && className)}
            role="tablist"
            aria-label={ariaLabel}
            ref={setBar}
            data-fill={fill}
            data-has-quick-action={Boolean(quickAction)}
            style={panel ? { '--tab-count': items.length } as CSSProperties : undefined}
        >
            {quickAction && (
                <PopoverTooltip content={quickAction.label} placement="top" gap={4}>
                    <button
                        type="button"
                        className={styles.quickAction}
                        aria-label={quickAction.label}
                        disabled={quickAction.disabled}
                        data-confirming={Boolean(quickAction.active)}
                        onClick={quickAction.onClick}
                    >
                        {quickAction.icon}
                    </button>
                </PopoverTooltip>
            )}
            {items.map((item) => (
                <button
                    key={item.key}
                    role="tab"
                    aria-selected={activeKey === item.key}
                    disabled={item.disabled}
                    data-tab={item.key}
                    className={styles.tab}
                    onClick={() => onChange(item.key)}
                    type="button"
                >
                    {item.icon}
                    {panel ? <span>{item.label}</span> : item.label}
                </button>
            ))}
            {activeItem && <span ref={indicatorRef} className={styles.tabIndicator} data-tab-indicator aria-hidden="true" />}
        </div>
    );
    if (panel) return bar;
    return (
        <div className={classNames(styles.tabBarWrapper, className)}>
            {bar}
            {activeItem?.description && <div className={styles.description}>{activeItem.description}</div>}
        </div>
    );
}

export default memo(TabView);

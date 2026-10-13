import {
    useCallback,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from 'react';
import AdaptiveLinearBlur from '@/component/effects/AdaptiveLinearBlur';
import styles from './notify.module.scss';

export default function Feed({
    children,
    listRef,
    resetKey,
    fadeClassName,
}: {
    children: ReactNode;
    listRef?: RefObject<HTMLDivElement | null>;
    resetKey?: string;
    fadeClassName?: string;
}) {
    const localRef = useRef<HTMLDivElement>(null);
    const ref = listRef ?? localRef;
    const [atBottom, setAtBottom] = useState(true);
    const update = useCallback(() => {
        const list = ref.current;
        if (list)
            setAtBottom(
                list.scrollTop + list.clientHeight >= list.scrollHeight - 1,
            );
    }, [ref]);
    useLayoutEffect(() => {
        const list = ref.current;
        if (list && resetKey !== undefined) list.scrollTop = 0;
    }, [ref, resetKey]);
    useLayoutEffect(() => {
        const list = ref.current;
        if (!list) return;
        const frame = requestAnimationFrame(update);
        list.addEventListener('transitionend', update);
        const observer = new ResizeObserver(update);
        observer.observe(list);
        return () => {
            cancelAnimationFrame(frame);
            list.removeEventListener('transitionend', update);
            observer.disconnect();
        };
    }, [children, ref, update]);
    return (
        <div className={styles.listViewport}>
            <div
                className={styles.notificationList}
                role='tabpanel'
                ref={ref}
                onScroll={update}
            >
                {children}
            </div>
            <AdaptiveLinearBlur
                side='bottom'
                strength={6}
                className={[
                    styles.listBottomBlur,
                    !atBottom ? styles.visible : '',
                    fadeClassName,
                ]
                    .filter(Boolean)
                    .join(' ')}
            />
        </div>
    );
}

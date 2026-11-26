import { memo, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import AdaptiveLinearBlur from '@/component/effects/AdaptiveLinearBlur';
import { useScrollEdges } from '@/lib/dom/useScrollEdges';
import { useAppDocument } from '@/platform/pictureInPicture';
import styles from '@/component/feed/Feed.module.scss';

type ListRef = RefObject<HTMLDivElement | null>;

const BottomFade = memo(function BottomFade({ listRef, contentRef }: {
    listRef: ListRef;
    contentRef: ListRef;
}) {
    const ownerDocument = useAppDocument();
    const { bottom } = useScrollEdges({ targetRef: listRef, contentRef, ownerDocument });
    return (
        <AdaptiveLinearBlur
            targetRef={listRef}
            visible={bottom}
            side="bottom"
            strength={6}
            className={`${styles.listBottomBlur} ${bottom ? styles.visible : ''}`}
        />
    );
});

export default function Feed({
    children,
    listRef,
    resetKey,
}: {
    children: ReactNode;
    listRef?: ListRef;
    resetKey?: string;
}) {
    const localRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const ref = listRef ?? localRef;

    useLayoutEffect(() => {
        const list = ref.current;
        if (list && resetKey !== undefined) list.scrollTop = 0;
    }, [ref, resetKey]);

    return (
        <div className={styles.listViewport}>
            <div className={styles.notificationList} role="tabpanel" ref={ref}>
                <div className={styles.listContent} ref={contentRef}>
                    {children}
                </div>
            </div>
            <BottomFade listRef={ref} contentRef={contentRef} />
        </div>
    );
}

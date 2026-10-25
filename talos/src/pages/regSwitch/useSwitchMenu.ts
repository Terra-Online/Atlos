import { useEffect, useRef, useState, type HTMLAttributes } from 'react';

/** One submenu owns pointer, keyboard or touch interaction at a time. */
export function useSwitchMenu(enabled = true) {
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!enabled) setActiveKey(null);
    }, [enabled]);

    useEffect(() => {
        const root = ref.current;
        if (!root || !enabled || activeKey === null) return;
        const doc = root.ownerDocument;
        const closeOutside = (event: PointerEvent) => {
            if (!root.contains(event.target as Node)) setActiveKey(null);
        };
        doc.addEventListener('pointerdown', closeOutside, true);
        return () => doc.removeEventListener('pointerdown', closeOutside, true);
    }, [activeKey, enabled]);

    const getItemProps = (key: string): HTMLAttributes<HTMLDivElement> => ({
        onPointerEnter: (event) => {
            if (event.pointerType !== 'touch') setActiveKey(key);
        },
        onPointerLeave: (event) => {
            if (event.pointerType !== 'touch') {
                setActiveKey((current) => current === key ? null : current);
            }
        },
        onFocus: (event) => {
            // Pointer focus must not reopen the region the mouse just left.
            if (event.target.matches(':focus-visible')) setActiveKey(key);
        },
        onBlur: (event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
                setActiveKey((current) => current === key ? null : current);
            }
        },
        onKeyDown: (event) => {
            if (event.key === 'Escape') setActiveKey(null);
        },
    });

    return { ref, activeKey, open: setActiveKey, getItemProps };
}

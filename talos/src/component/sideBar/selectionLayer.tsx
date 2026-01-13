import React, { useLayoutEffect, useRef, useState } from 'react';
import styles from './sideBar.module.scss';
import { useBoxSelection } from './useBoxSelection';

interface SelectionLayerProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
}

export const SelectionLayer = ({ containerRef }: SelectionLayerProps) => {
    const { isSelecting, selectionBox } = useBoxSelection(containerRef);
    
    const [fadingState, setFadingState] = useState<{ box: typeof selectionBox, active: boolean } | null>(null);
    const lastBoxRef = useRef(selectionBox);

    // Track the latest non-null box
    if (selectionBox) {
        lastBoxRef.current = selectionBox;
    }

    useLayoutEffect(() => {
        if (isSelecting) {
            // Started selection, clear fading
            setFadingState(null);
            return;
        }

        if (!lastBoxRef.current) return;

        // Ended selection: render box at opacity 1 first, then fade out next frame.
        setFadingState({ box: lastBoxRef.current, active: false });
        const raf = requestAnimationFrame(() => {
            setFadingState((prev) => (prev ? { ...prev, active: true } : prev));
        });

        const timer = setTimeout(() => {
            setFadingState(null);
        }, 300);

        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(timer);
        };
    }, [isSelecting]);

    const box = isSelecting ? selectionBox : fadingState?.box;
    const isFading = !isSelecting && fadingState?.active;

    if (!box) return null;

    return (
        <div
            className={`${styles.selectionBox} ${isFading ? styles.fadeOut : ''}`}
            style={{
                left: Math.min(box.startX, box.endX),
                top: Math.min(box.startY, box.endY),
                width: Math.abs(box.endX - box.startX),
                height: Math.abs(box.endY - box.startY),
            }}
        />
    );
};

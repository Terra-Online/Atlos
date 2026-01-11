import React, { useEffect, useState } from 'react';
import styles from './sideBar.module.scss';
import { useBoxSelection } from './useBoxSelection';

interface SelectionLayerProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
}

export const SelectionLayer = ({ containerRef }: SelectionLayerProps) => {
    const { isSelecting, selectionBox } = useBoxSelection(containerRef);
    const [renderData, setRenderData] = useState<{ box: typeof selectionBox, isFading: boolean } | null>(null);

    // Sync state to handle fade out
    useEffect(() => {
        if (isSelecting && selectionBox) {
            setRenderData({ box: selectionBox, isFading: false });
        } else if (!isSelecting && renderData?.box && !renderData.isFading) {
            // Start fade out
            setRenderData(prev => prev ? { ...prev, isFading: true } : null);
            const timer = setTimeout(() => {
                setRenderData(null);
            }, 250);
            return () => clearTimeout(timer);
        }
    }, [isSelecting, selectionBox]); // Only depend on external props

    // Render nothing if no data or no box data
    if (!renderData || !renderData.box) return null;

    const { box, isFading } = renderData;

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

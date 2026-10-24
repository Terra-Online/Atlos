import { useSelectionVisibility } from '@/component/selection/useSelectionVisibility';
import React, { useRef } from 'react';
import styles from '@/component/shared/siteShell/sideBar.module.scss';
import { useBoxSelection } from '@/pages/sideBar/useBoxSelection';

interface SelectionLayerProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
}

export const SelectionLayer = ({ containerRef }: SelectionLayerProps) => {
    const selectionBoxRef = useRef<HTMLDivElement | null>(null);
    const { isSelecting } = useBoxSelection(containerRef, selectionBoxRef);
    
    const { visible: isVisible, fading: isFading } = useSelectionVisibility(isSelecting, 300);

    return (
        <div
            ref={selectionBoxRef}
            className={`${styles.selectionBox} ${isVisible ? '' : styles.hidden} ${isFading ? styles.fadeOut : ''}`}
        />
    );
};

import React, { useEffect, useRef, useState } from 'react';
import { useFilter, useSetFilter } from '@/store/marker';

export const useBoxSelection = (containerRef: React.RefObject<HTMLDivElement | null>) => {
    const filter = useFilter();
    const setFilter = useSetFilter();
    const currentFilterRef = useRef(filter);
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionBox, setSelectionBox] = useState<null | { startX: number, startY: number, endX: number, endY: number }>(null);

    useEffect(() => { currentFilterRef.current = filter; }, [filter]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let startPoint: { x: number, y: number } | null = null;
        let isDragging = false;
        let initialFilter: string[] = [];
        let itemsRects: { key: string, rect: DOMRect }[] = [];

        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0 || e.defaultPrevented) return;
            const target = e.target as HTMLElement;
            // Ignore interactive elements
            if (target.closest('button') || target.closest('input') || target.closest('[data-drag-handle]')) return;
            // Ignore drawer area
            if (target.closest(`div[class*="triggerDrawer"]`)) return;

            const sbRect = container.getBoundingClientRect();
            startPoint = {
                x: e.clientX - sbRect.left,
                y: e.clientY - sbRect.top
            };
            initialFilter = currentFilterRef.current;
            
            // Gather all selectable items and their rects
            // Handle non-null assertion by filtering
            itemsRects = [];
            const elements = container.querySelectorAll('[data-key]');
            elements.forEach(el => {
                // Use checkVisibility to respect visibility: hidden (which we use for collapsed groups)
                // checkVisibility is a modern DOM API - type assertion needed for compatibility
                const element = el as HTMLElement & { checkVisibility?: () => boolean };
                if (element.checkVisibility && !element.checkVisibility()) return;
                
                // Also check if element is inside a collapsed filterContent
                // (grid-template-rows: 0fr doesn't trigger checkVisibility)
                const filterContent = el.closest('[class*="filterContent"]');
                if (filterContent && !filterContent.classList.toString().includes('expanded')) return;
                
                const key = el.getAttribute('data-key');
                if (key) {
                    itemsRects.push({
                        key,
                        rect: el.getBoundingClientRect()
                    });
                }
            });

            // Disable user-select during selection to enforce box selection
            document.body.style.userSelect = 'none';

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!startPoint) return;
            const sbRect = container.getBoundingClientRect();
            const curX = e.clientX - sbRect.left;
            const curY = e.clientY - sbRect.top;

            if (!isDragging) {
                const dx = curX - startPoint.x;
                const dy = curY - startPoint.y;
                // Threshold to start dragging
                if (dx * dx + dy * dy > 25) {
                    isDragging = true;
                    setIsSelecting(true);
                }
            }

            if (isDragging) {
                setSelectionBox({
                    startX: startPoint.x,
                    startY: startPoint.y,
                    endX: curX,
                    endY: curY
                });

                // Calculate box in Viewport coordinates for intersection testing
                const absStartX = startPoint.x + sbRect.left;
                const absStartY = startPoint.y + sbRect.top;
                
                const boxLeft = Math.min(absStartX, e.clientX);
                const boxRight = Math.max(absStartX, e.clientX);
                const boxTop = Math.min(absStartY, e.clientY);
                const boxBottom = Math.max(absStartY, e.clientY);

                const nextSet = new Set(initialFilter);
                
                itemsRects.forEach(it => {
                    // Check intersection
                    const intersect = !(it.rect.left > boxRight || it.rect.right < boxLeft || 
                                      it.rect.top > boxBottom || it.rect.bottom < boxTop);
                    
                    if (intersect) {
                        // Toggle logic: If key was in initial set, remove it. If not, add it.
                        if (nextSet.has(it.key)) nextSet.delete(it.key);
                        else nextSet.add(it.key);
                    }
                });
                
                setFilter(Array.from(nextSet));
            }
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            document.body.style.userSelect = '';
            startPoint = null;
            isDragging = false;
            setIsSelecting(false);
            setSelectionBox(null);
            itemsRects = [];
        };

        container.addEventListener('mousedown', onMouseDown);
        return () => {
            container.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [setFilter, containerRef]);

    return { isSelecting, selectionBox };
};

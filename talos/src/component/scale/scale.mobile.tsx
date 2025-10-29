import React, {
    useState,
    useEffect,
    useRef,
    useCallback,
    useMemo,
} from 'react';
// No drag translate/scale animations; Motion not needed
import styles from './scale.module.scss';
import L from 'leaflet';

const calculateScale = (current: number, min: number, max: number) =>
    Math.max(0, Math.min(1, (current - min) / (max - min)));

const ScaleMobile = ({ map }: { map: L.Map }) => {
    const [zoomLevel, setZoomLevel] = useState(map?.getZoom() || 0);
    const [zoomBounds, setZoomBounds] = useState({
        min: map?.getMinZoom() || 0,
        max: map?.getMaxZoom() || 3,
    });
    const [isDragging, setIsDragging] = useState(false);
    // Use CSS variable for drag distance; avoid React state to prevent re-render thrash
    
    const scalerRef = useRef<HTMLDivElement>(null);
    const scalerWrapperRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animationFrameRef = useRef<number>(null);
    const isZoomingRef = useRef<boolean>(false);
    const targetZoomRef = useRef<number>(null);
    const touchStartYRef = useRef<number>(null);
    const lastTouchYRef = useRef<number>(null);
    const initialZoomRef = useRef<number>(null); // Store initial zoom when drag starts

    const scaleRatio = useMemo(
        () => calculateScale(zoomLevel, zoomBounds.min, zoomBounds.max),
        [zoomLevel, zoomBounds.min, zoomBounds.max],
    );

    const updateScalerUI = useCallback((newScale: number) => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
        animationFrameRef.current = requestAnimationFrame(() => {
            if (scalerWrapperRef.current) {
                scalerWrapperRef.current.style.setProperty(
                    '--scale',
                    newScale.toString(),
                );
            }
            animationFrameRef.current = null;
        });
    }, []);

    const handleZoomChange = useCallback(
        (newZoom: number) => {
            if (!map) return;
            const validZoom = Math.max(
                zoomBounds.min,
                Math.min(zoomBounds.max, newZoom),
            );
            if (targetZoomRef.current === validZoom) return;
            isZoomingRef.current = true;
            targetZoomRef.current = validZoom;
            const newScale = calculateScale(
                validZoom,
                zoomBounds.min,
                zoomBounds.max,
            );
            updateScalerUI(newScale);
            map.setZoom(validZoom, { animate: true });
        },
        [map, zoomBounds, updateScalerUI],
    );

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        // Prevent map dragging
        e.stopPropagation();
        if (map) {
            map.dragging.disable();
        }
        
        setIsDragging(true);
        const touch = e.touches[0];
        touchStartYRef.current = touch.clientY;
        lastTouchYRef.current = touch.clientY;
        initialZoomRef.current = zoomLevel; // Store current zoom level
        // Cancel any pending release animation and clear inline transform
        if (scalerWrapperRef.current) {
            scalerWrapperRef.current.getAnimations().forEach((a) => a.cancel());
            // Keep current transform as-is; move handler will take over
        }
    }, [map, zoomLevel]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        e.stopPropagation();
        // Don't call preventDefault - CSS touch-action: none handles this
        
        if (!scalerWrapperRef.current || !map || touchStartYRef.current === null || lastTouchYRef.current === null || initialZoomRef.current === null) return;
        
        const touch = e.touches[0];
        const currentY = touch.clientY;
        lastTouchYRef.current = currentY;

        // Calculate total drag distance from start
        const totalDragDistance = touchStartYRef.current - currentY; // up = positive

        // Calculate new zoom based on cumulative drag from start
    const rect = scalerWrapperRef.current.getBoundingClientRect();
    const wrapperHeight = rect.height || 1;
    const ratioFromStart = totalDragDistance / wrapperHeight; // up increases
        const zoomRange = zoomBounds.max - zoomBounds.min;
        const unclampedZoom = (initialZoomRef.current ?? zoomLevel) + ratioFromStart * zoomRange;
        const newZoom = Math.max(zoomBounds.min, Math.min(zoomBounds.max, unclampedZoom));

        handleZoomChange(newZoom);
    }, [map, zoomLevel, zoomBounds, handleZoomChange]);

    const handleTouchEnd = useCallback(() => {
        // Re-enable map dragging
        if (map) {
            map.dragging.enable();
        }
        
        setIsDragging(false);
        touchStartYRef.current = null;
        lastTouchYRef.current = null;
        initialZoomRef.current = null;
        
        // Ensure no leftover animations or transforms
        if (scalerWrapperRef.current) {
            scalerWrapperRef.current.getAnimations().forEach((a) => a.cancel());
            scalerWrapperRef.current.style.removeProperty('--drag-distance');
            scalerWrapperRef.current.style.transform = '';
        }
    }, [map]);

    useEffect(() => {
        if (!map) return;
        const initialZoom = map.getZoom();
        setZoomLevel(initialZoom);
        setZoomBounds({
            min: map.getMinZoom(),
            max: map.getMaxZoom(),
        });
        targetZoomRef.current = initialZoom;

        const initialScale = calculateScale(
            initialZoom,
            map.getMinZoom(),
            map.getMaxZoom(),
        );
        updateScalerUI(initialScale);

        const handleZoomStart = () => {
            isZoomingRef.current = true;
        };
        const handleZoomAnim = (e: L.ZoomAnimEvent) => {
            if (isZoomingRef.current) {
                const currentZoom = e.zoom;
                const scale = calculateScale(
                    currentZoom,
                    map.getMinZoom(),
                    map.getMaxZoom(),
                );
                updateScalerUI(scale);
            }
        };
        const handleZoomEnd = () => {
            const finalZoom = map.getZoom();
            setZoomLevel(finalZoom);
            targetZoomRef.current = finalZoom;
            isZoomingRef.current = false;
        };
        
        map.on('zoomstart', handleZoomStart);
        map.on('zoomanim', handleZoomAnim);
        map.on('zoomend', handleZoomEnd);
        map.on('zoom', handleZoomEnd);
        
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            map.off('zoomstart', handleZoomStart);
            map.off('zoomanim', handleZoomAnim);
            map.off('zoomend', handleZoomEnd);
            map.off('zoom', handleZoomEnd);
        };
    }, [map, updateScalerUI]);

    useEffect(() => {
        updateScalerUI(scaleRatio);
    }, [scaleRatio, updateScalerUI]);

    if (!map) return null;
    
    return (
        <div 
            ref={containerRef}
            className={`${styles.scaleContainerMobile} ${isDragging ? styles.dragging : ''}`}
        >
            <div
                className={styles.scalerWrapperMobile}
                ref={scalerWrapperRef}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
            >
                <div className={styles.scalerMobile} ref={scalerRef} />
            </div>
        </div>
    );
};

export default React.memo(ScaleMobile);

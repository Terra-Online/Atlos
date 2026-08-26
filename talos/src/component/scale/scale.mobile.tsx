import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { TalosMap } from '@/component/mapCore/engine';
import styles from './scale.module.scss';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const calcScale = (z: number, min: number, max: number) => clamp((z - min) / (max - min), 0, 1);
// 与迁移前地图配置（zoomSnap: 0.25）一致；TalosMap 无 zoomSnap 选项，这里用常量
const ZOOM_SNAP = 0.25;

const ScaleMobile = ({ map }: { map: TalosMap }) => {
    const [zoomLevel, setZoomLevel] = useState(map?.getZoom() ?? 0);
    const [bounds, setBounds] = useState({
        min: map?.getMinZoom() ?? 0,
        max: map?.getMaxZoom() ?? 3,
    });
    const [dragging, setDragging] = useState(false);

    const wrapRef = useRef<HTMLDivElement>(null);
    const touchStartRef = useRef<number | null>(null);
    const initialZoomRef = useRef<number | null>(null);
    const frameRef = useRef<number | null>(null);
    const zoomFrameRef = useRef<number | null>(null);
    const pendingZoomRef = useRef<number | null>(null);

    // Derived ratio was unused; removed to avoid unused variable warning

    const setUIScale = useCallback((s: number) => {
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => {
            wrapRef.current?.style.setProperty('--scale', s.toString());
            frameRef.current = null;
        });
    }, []);

    const snapZoom = useCallback(
        (z: number) => {
            const clamped = clamp(z, bounds.min, bounds.max);
            return clamp(Math.round(clamped / ZOOM_SNAP) * ZOOM_SNAP, bounds.min, bounds.max);
        },
        [bounds]
    );

    const cancelPendingZoom = useCallback(() => {
        if (zoomFrameRef.current !== null) {
            cancelAnimationFrame(zoomFrameRef.current);
            zoomFrameRef.current = null;
        }
    }, []);

    const scheduleZoom = useCallback((zoom: number) => {
        pendingZoomRef.current = zoom;
        if (zoomFrameRef.current !== null || !map) return;

        zoomFrameRef.current = requestAnimationFrame(() => {
            zoomFrameRef.current = null;
            const pendingZoom = pendingZoomRef.current;
            pendingZoomRef.current = null;
            if (pendingZoom !== null) {
                map.setZoom(pendingZoom, { animate: false });
            }
        });
    }, [map]);

    // --- Touch handlers ---
    const onTouchStart = useCallback((e: React.TouchEvent) => {
        e.stopPropagation();
        cancelPendingZoom();
        pendingZoomRef.current = null;
        map?.dragging.disable();
        setDragging(true);
        const y = e.touches[0].clientY;
        touchStartRef.current = y;
        initialZoomRef.current = zoomLevel;
    }, [map, zoomLevel, cancelPendingZoom]);

    const onTouchMove = useCallback((e: React.TouchEvent) => {
        e.stopPropagation();
        if (touchStartRef.current === null || !wrapRef.current || initialZoomRef.current === null) return;
        const deltaY = touchStartRef.current - e.touches[0].clientY;
        const h = wrapRef.current.getBoundingClientRect().height || 1;
        const dz = (deltaY / h) * (bounds.max - bounds.min);
        const newZoom = clamp(initialZoomRef.current + dz, bounds.min, bounds.max);
        setUIScale(calcScale(newZoom, bounds.min, bounds.max));
        scheduleZoom(newZoom);
    }, [bounds, setUIScale, scheduleZoom]);

    const onTouchEnd = useCallback(() => {
        if (!map) return;
        cancelPendingZoom();
        const clamped = snapZoom(pendingZoomRef.current ?? map.getZoom());
        pendingZoomRef.current = null;
        map.setZoom(clamped, { animate: true });
        setZoomLevel(clamped);
        setUIScale(calcScale(clamped, bounds.min, bounds.max));
        setDragging(false);
        map.dragging.enable();
        touchStartRef.current = null;
        initialZoomRef.current = null;
    }, [map, bounds, snapZoom, setUIScale, cancelPendingZoom]);

    // --- Sync with map zoom ---
    useEffect(() => {
        if (!map) return;
        const sync = () => {
            const z = map.getZoom();
            setZoomLevel(z);
            setUIScale(calcScale(z, bounds.min, bounds.max));
        };
        map.on('zoom', sync);
        return () => {
            map.off('zoom', sync);
        };
    }, [map, bounds, setUIScale]);

    // --- Init ---
    useEffect(() => {
        if (!map) return;
        
        const updateBounds = () => {
            const min = map.getMinZoom(), max = map.getMaxZoom();
            setBounds({ min, max });
            setZoomLevel(map.getZoom());
            setUIScale(calcScale(map.getZoom(), min, max));
        };

        updateBounds();
        map.on('talos:regionSwitched', updateBounds);
        
        return () => {
            map.off('talos:regionSwitched', updateBounds);
        };
    }, [map, setUIScale]);

    useEffect(() => () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        cancelPendingZoom();
    }, [cancelPendingZoom]);

    return (
        <div className={`${styles.scaleContainerMobile} ${dragging ? styles.dragging : ''}`}>
            <div
                className={styles.scalerWrapperMobile}
                ref={wrapRef}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                onTouchCancel={onTouchEnd}
            >
                <div className={styles.scalerMobile} />
            </div>
        </div>
    );
};

export default React.memo(ScaleMobile);

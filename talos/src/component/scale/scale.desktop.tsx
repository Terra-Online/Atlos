import React, {
    useState,
    useEffect,
    useRef,
    useCallback,
    useMemo,
} from 'react';
import styles from './scale.module.scss';
import type { TalosMap } from '@/component/mapCore/engine';
import { useAppPictureInPicture } from './pip';
import PopoverTooltip from '@/component/popover/popover';
import { useTranslateUI } from '@/locale';

const calculateScale = (current: number, min: number, max: number) =>
    Math.max(0, Math.min(1, (current - min) / (max - min)));

const ScaleDesktop = ({ map }: { map: TalosMap }) => {
    const tUI = useTranslateUI();
    const [zoomLevel, setZoomLevel] = useState(map?.getZoom() || 0);
    const [zoomBounds, setZoomBounds] = useState({
        min: map?.getMinZoom() || 0,
        max: map?.getMaxZoom() || 3,
    });
    const scalerRef = useRef<HTMLDivElement>(null);
    const scalerWrapperRef = useRef<HTMLDivElement>(null);
    const animationFrameRef = useRef<number>(null);
    const isZoomingRef = useRef<boolean>(false);
    const targetZoomRef = useRef<number>(null);
    const pictureInPicture = useAppPictureInPicture(map);

    const ZOOM_STEP = 0.5; // +/- step

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
            // Escape delay
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
    const handleZoomStep = useCallback(
        (direction) => {
            const step = direction * ZOOM_STEP;
            handleZoomChange(zoomLevel + step);
        },
        [zoomLevel, handleZoomChange],
    );
    const handleProgressClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
            if (!scalerWrapperRef.current || !map) return;
            const rect = scalerWrapperRef.current.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const wrapperHeight = rect.height;
            const clickRatio = 1 - clickY / wrapperHeight;
            const zoomRange = zoomBounds.max - zoomBounds.min;
            const newZoom = zoomBounds.min + clickRatio * zoomRange;
            handleZoomChange(newZoom);
        },
        [map, zoomBounds, handleZoomChange],
    );
    const handlePictureInPictureToggle = useCallback(() => {
        void pictureInPicture.toggle();
    }, [pictureInPicture]);

    useEffect(() => {
        if (!map) return;
        const initialZoom = map.getZoom();
        setZoomLevel(initialZoom);
        
        const updateBounds = () => {
            setZoomBounds({
                min: map.getMinZoom(),
                max: map.getMaxZoom(),
            });
        }
        updateBounds();

        targetZoomRef.current = initialZoom;

        const initialScale = calculateScale(
            initialZoom,
            map.getMinZoom(),
            map.getMaxZoom(),
        );
        updateScalerUI(initialScale);

        // Synchronize map zoom events
        const handleZoomStart = () => {
            isZoomingRef.current = true;
        };
        // TalosMap 的 'zoom' 在动画期间每帧触发，同时覆盖旧 zoomanim 的比例尺刷新用途
        const handleZoom = () => {
            const currentZoom = map.getZoom();
            setZoomLevel(currentZoom);
            updateScalerUI(
                calculateScale(
                    currentZoom,
                    map.getMinZoom(),
                    map.getMaxZoom(),
                ),
            );
        };
        const handleZoomEnd = () => {
            const finalZoom = map.getZoom();
            setZoomLevel(finalZoom);
            targetZoomRef.current = finalZoom;
            isZoomingRef.current = false;
        };

        const handleRegionSwitched = () => {
            updateBounds();
            // Force update UI with new bounds
            const z = map.getZoom();
            setZoomLevel(z);
            // bounds state update will trigger re-render of scaleRatio -> calls updateScalerUI via effect below
        };

        // Listen & Release
        map.on('zoomstart', handleZoomStart);
        map.on('zoomend', handleZoomEnd);
        map.on('zoom', handleZoom);
        map.on('talos:regionSwitched', handleRegionSwitched);

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            map.off('zoomstart', handleZoomStart);
            map.off('zoomend', handleZoomEnd);
            map.off('zoom', handleZoom);
            map.off('talos:regionSwitched', handleRegionSwitched);
        };
    }, [map, updateScalerUI]);
    useEffect(() => {
        updateScalerUI(scaleRatio);
    }, [scaleRatio, updateScalerUI]);
    if (!map) return null;
    return (
        <div className={styles.scaleContainer}>
            <div className={styles.buttonFrame}>
                <button
                    className={`${styles.zoomButton} ${styles.in} ${zoomLevel >= zoomBounds.max ? styles.disabled : ''}`}
                    onClick={() => handleZoomStep(1)}
                    disabled={zoomLevel >= zoomBounds.max}
                >
                    +
                </button>
            </div>

            <div
                className={styles.scalerWrapper}
                ref={scalerWrapperRef}
                onClick={handleProgressClick}
            >
                <div className={styles.scaler} ref={scalerRef} />
            </div>

            <div className={styles.buttonFrame}>
                <button
                    className={`${styles.zoomButton} ${styles.out} ${zoomLevel <= zoomBounds.min ? styles.disabled : ''}`}
                    onClick={() => handleZoomStep(-1)}
                    disabled={zoomLevel <= zoomBounds.min}
                >
                    -
                </button>
            </div>

            <div className={`${styles.buttonFrame} ${styles.pipFrame}`}>
                <PopoverTooltip
                    content={pictureInPicture.supported
                        ? tUI(pictureInPicture.active ? 'scale.pip.exitMode' : 'scale.pip.enterMode')
                        : tUI('scale.pip.unsupported')}
                    placement="left"
                    gap={8}
                >
                    <button
                        type="button"
                        className={`${styles.zoomButton} ${styles.pipButton} ${pictureInPicture.active ? styles.active : ''} ${!pictureInPicture.supported ? styles.disabled : ''}`}
                        onClick={handlePictureInPictureToggle}
                        disabled={!pictureInPicture.supported}
                        aria-label={tUI(pictureInPicture.active ? 'scale.pip.exitMode' : 'scale.pip.enterMode')}
                    >
                        PiP
                    </button>
                </PopoverTooltip>
            </div>
        </div>
    );
};

export default React.memo(ScaleDesktop);

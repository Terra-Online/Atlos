import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './scale.scss';

const calculateScale = (current, min, max) => Math.max(0, Math.min(1, (current - min) / (max - min)));

const Scale = ({ map }) => {
  const [zoomLevel, setZoomLevel] = useState(map?.getZoom() || 0);
  const [zoomBounds, setZoomBounds] = useState({
    min: map?.getMinZoom() || 0,
    max: map?.getMaxZoom() || 3
  });
  const scalerRef = useRef(null);
  const scalerWrapperRef = useRef(null);
  const animationFrameRef = useRef(null);
  const isZoomingRef = useRef(false);
  const targetZoomRef = useRef(null);

  const ZOOM_STEP = 0.5;// +/- step

  const scaleRatio = useMemo(() =>
    calculateScale(zoomLevel, zoomBounds.min, zoomBounds.max),
  [zoomLevel, zoomBounds.min, zoomBounds.max]);

  const updateScalerUI = useCallback((newScale) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(() => {
      if (scalerWrapperRef.current) {
        scalerWrapperRef.current.style.setProperty('--scale', newScale);
      }
      animationFrameRef.current = null;
    });
  }, []);

  const handleZoomChange = useCallback((newZoom) => {
    if (!map) return;
    const validZoom = Math.max(zoomBounds.min, Math.min(zoomBounds.max, newZoom));
    if (targetZoomRef.current === validZoom) return;
    isZoomingRef.current = true;
    targetZoomRef.current = validZoom;
    // Escape delay
    const newScale = calculateScale(validZoom, zoomBounds.min, zoomBounds.max);
    updateScalerUI(newScale);
    map.setZoom(validZoom, {animate: true});
  }, [map, zoomBounds, updateScalerUI]);
  const handleZoomStep = useCallback((direction) => {
    const step = direction * ZOOM_STEP;
    handleZoomChange(zoomLevel + step);
  }, [zoomLevel, handleZoomChange]);
  const handleProgressClick = useCallback((e) => {
    if (!scalerWrapperRef.current || !map) return;
    const rect = scalerWrapperRef.current.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const wrapperHeight = rect.height;
    const clickRatio = 1 - (clickY / wrapperHeight);
    const zoomRange = zoomBounds.max - zoomBounds.min;
    const newZoom = zoomBounds.min + (clickRatio * zoomRange);
    handleZoomChange(newZoom);
  }, [map, zoomBounds, handleZoomChange]);
  useEffect(() => {
    if (!map) return;
    const initialZoom = map.getZoom();
    setZoomLevel(initialZoom);
    setZoomBounds({
      min: map.getMinZoom(),
      max: map.getMaxZoom()
    });
    targetZoomRef.current = initialZoom;

    const initialScale = calculateScale(initialZoom, map.getMinZoom(), map.getMaxZoom());
    updateScalerUI(initialScale);

    // Synchronize map zoom events
    const handleZoomStart = () => {
      isZoomingRef.current = true;
    };
    const handleZoomAnim = (e) => {
      if (isZoomingRef.current) {
        const currentZoom = e.zoom;
        const scale = calculateScale(currentZoom, map.getMinZoom(), map.getMaxZoom());
        updateScalerUI(scale);
      }
    };
    const handleZoomEnd = () => {
      const finalZoom = map.getZoom();
      setZoomLevel(finalZoom);
      targetZoomRef.current = finalZoom;
      isZoomingRef.current = false;
    };
    // Listen & Release
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
    <div className="scale-container">
      <div className="button-frame">
        <button
          className={`zoom-button in ${zoomLevel >= zoomBounds.max ? 'disabled' : ''}`}
          onClick={() => handleZoomStep(1)}
          disabled={zoomLevel >= zoomBounds.max}
        >
          +
        </button>
      </div>

      <div
        className="scaler-wrapper"
        ref={scalerWrapperRef}
        onClick={handleProgressClick}
      >
        <div
          className="scaler"
          ref={scalerRef}
        />
      </div>

      <div className="button-frame">
        <button
          className={`zoom-button out ${zoomLevel <= zoomBounds.min ? 'disabled' : ''}`}
          onClick={() => handleZoomStep(-1)}
          disabled={zoomLevel <= zoomBounds.min}
        >
          -
        </button>
      </div>
    </div>
  );
};

export default React.memo(Scale);
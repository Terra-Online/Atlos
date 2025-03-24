import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './scale.scss';

// Helper function to calculate scale ratio
const calculateScale = (current, min, max) => Math.max(0, Math.min(1, (current - min) / (max - min)));

// ZoomLabel component for individual zoom level shortcuts
const ZoomLabel = React.memo(({ zoomLevel, position, onClick, isActive, isVisible, isTransitioning = false }) => {
  // Determine label style based on position (0-1 represents top to bottom)
  const labelStyle = {
    bottom: `calc(${position * 100}% - 10px)`,
    opacity: isVisible ? 1 : 0,
    transform: isVisible ? 'translateX(0)' : 'translateX(10px)',
    transition: isTransitioning
      ? 'opacity 300ms ease, transform 300ms ease, bottom 400ms ease-in-out'
      : 'opacity 300ms ease, transform 300ms ease'
  };

  return (
    <div
      className={`zoom-label ${isActive ? 'active' : ''}`}
      style={labelStyle}
      onClick={() => onClick(zoomLevel)}
    >
      {Math.round(zoomLevel)}
    </div>
  );
});

const Scale = ({ map }) => {
  const [zoomLevel, setZoomLevel] = useState(map?.getZoom() || 0);
  const [zoomBounds, setZoomBounds] = useState({
    min: map?.getMinZoom() || 0,
    max: map?.getMaxZoom() || 3
  });
  // Track zoom labels and their animation states
  const [zoomLabels, setZoomLabels] = useState([]);
  const [isAnimating, setIsAnimating] = useState(false);

  const scalerRef = useRef(null);
  const scalerWrapperRef = useRef(null);
  const animationFrameRef = useRef(null);
  const isZoomingRef = useRef(false);
  const targetZoomRef = useRef(null);
  const lastMaxZoomRef = useRef(map?.getMaxZoom() || 3); // Track last maxZoom to detect changes

  const ZOOM_STEP = 0.5; // +/- step
  const ANIMATION_DURATION = 400; // ms
  const TRANSITION_STAGGER = 50; // ms between animation phases

  // Calculate current scale ratio
  const scaleRatio = useMemo(() =>
    calculateScale(zoomLevel, zoomBounds.min, zoomBounds.max),
    [zoomLevel, zoomBounds.min, zoomBounds.max]);

  // Generate labels for integer zoom levels
  const generateZoomLabels = useCallback(() => {
    const labels = [];
    const minZoom = Math.ceil(zoomBounds.min);
    const maxZoom = Math.floor(zoomBounds.max);

    for (let i = minZoom; i <= maxZoom; i++) {
      // Calculate position (0-1) of this label on the scale
      const position = calculateScale(i, zoomBounds.min, zoomBounds.max);
      labels.push({
        level: i,
        position,
        isVisible: true,
        isTransitioning: false
      });
    }

    return labels;
  }, [zoomBounds.min, zoomBounds.max]);

  // Update labels when zoom bounds change
  useEffect(() => {
    if (!map) return;

    // Handle label transitions
    if (zoomLabels.length > 0) {
      // Start animation
      setIsAnimating(true);

      // Get new labels configuration
      const newLabelsData = generateZoomLabels();
      const existingLevels = new Set(newLabelsData.map(l => l.level));
      const currentLevels = new Set(zoomLabels.map(l => l.level));

      // Phase 1: Mark existing labels for transition and fade out those to be removed
      setZoomLabels(prevLabels => {
        return prevLabels.map(label => ({
          ...label,
          isTransitioning: true,
          isVisible: existingLevels.has(label.level)
        }));
      });

      // Phase 2: Update positions of remaining labels and add new labels (invisible)
      setTimeout(() => {
        setZoomLabels(prevLabels => {
          // Keep existing labels that should remain
          const remainingLabels = prevLabels
            .filter(label => existingLevels.has(label.level))
            .map(label => {
              // Find new position for this label
              const newPos = newLabelsData.find(l => l.level === label.level).position;
              return {
                ...label,
                position: newPos,
                isTransitioning: true
              };
            });

          // Add new labels (initially invisible)
          const newLabels = newLabelsData
            .filter(label => !currentLevels.has(label.level))
            .map(label => ({
              ...label,
              isVisible: false,
              isTransitioning: true
            }));

          return [...remainingLabels, ...newLabels];
        });

        // Phase 3: Fade in new labels
        setTimeout(() => {
          setZoomLabels(prevLabels =>
            prevLabels.map(label => ({
              ...label,
              isVisible: true,
              isTransitioning: true
            }))
          );

          // Phase 4: Complete transition
          setTimeout(() => {
            setZoomLabels(prevLabels =>
              prevLabels.map(label => ({
                ...label,
                isTransitioning: false
              }))
            );
            setIsAnimating(false);
          }, ANIMATION_DURATION);

        }, TRANSITION_STAGGER);

      }, ANIMATION_DURATION / 2);

    } else {
      // Initial load, no animation needed
      setZoomLabels(generateZoomLabels());
    }
  }, [map, zoomBounds.min, zoomBounds.max, generateZoomLabels]);

  // Update scaler UI
  const updateScalerUI = useCallback((newScale) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      if (scalerRef.current) {
        scalerRef.current.style.setProperty('--scale', newScale);
      }
      animationFrameRef.current = null;
    });
  }, []);

  // Handle zoom changes
  const handleZoomChange = useCallback((newZoom) => {
    if (!map) return;
    const validZoom = Math.max(zoomBounds.min, Math.min(zoomBounds.max, newZoom));
    if (targetZoomRef.current === validZoom) return;
    isZoomingRef.current = true;
    targetZoomRef.current = validZoom;
    // Escape delay
    const newScale = calculateScale(validZoom, zoomBounds.min, zoomBounds.max);
    updateScalerUI(newScale);
    map.setZoom(validZoom, { animate: true });
  }, [map, zoomBounds, updateScalerUI]);

  // Handle zoom step buttons
  const handleZoomStep = useCallback((direction) => {
    const step = direction * ZOOM_STEP;
    handleZoomChange(zoomLevel + step);
  }, [zoomLevel, handleZoomChange]);

  // Handle click on the scaler wrapper
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

  // Handle label click
  const handleLabelClick = useCallback((level) => {
    handleZoomChange(level);
  }, [handleZoomChange]);

  // Check for map configuration changes (especially for region changes)
  useEffect(() => {
    if (!map) return;

    // Create an interval to check for changes in map maxZoom
    const checkMapConfigInterval = setInterval(() => {
      const currentMaxZoom = map.getMaxZoom();
      const currentMinZoom = map.getMinZoom();

      // If maxZoom or minZoom changed (likely due to region change)
      if (currentMaxZoom !== lastMaxZoomRef.current ||
        currentMinZoom !== zoomBounds.min) {

        console.log(`Zoom bounds changed: ${zoomBounds.min}-${zoomBounds.max} -> ${currentMinZoom}-${currentMaxZoom}`);

        // Update the zoom bounds
        setZoomBounds({
          min: currentMinZoom,
          max: currentMaxZoom
        });

        // Update our reference
        lastMaxZoomRef.current = currentMaxZoom;

        // Ensure current zoom level is within new bounds
        const currentZoom = map.getZoom();
        if (currentZoom > currentMaxZoom) {
          map.setZoom(currentMaxZoom);
        } else if (currentZoom < currentMinZoom) {
          map.setZoom(currentMinZoom);
        }
      }
    }, 300); // Check every 300ms

    return () => {
      clearInterval(checkMapConfigInterval);
    };
  }, [map, zoomBounds.min, zoomBounds.max]);

  // Initial setup and event listeners
  useEffect(() => {
    if (!map) return;
    const initialZoom = map.getZoom();
    setZoomLevel(initialZoom);
    setZoomBounds({
      min: map.getMinZoom(),
      max: map.getMaxZoom()
    });
    lastMaxZoomRef.current = map.getMaxZoom();
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

  // Update UI when scale ratio changes
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

        {/* Zoom level labels */}
        {zoomLabels.map(label => (
          <ZoomLabel
            key={label.level}
            zoomLevel={label.level}
            position={label.position}
            onClick={handleLabelClick}
            isActive={Math.round(zoomLevel) === label.level}
            isVisible={label.isVisible}
            isTransitioning={label.isTransitioning}
          />
        ))}
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
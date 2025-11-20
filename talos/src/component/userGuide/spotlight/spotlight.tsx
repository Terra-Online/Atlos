import React, { useEffect, useState, useCallback } from 'react';
import styles from './spotlight.module.scss';

interface SpotlightProps {
  getCurrentTarget: () => Element | null;
  active: boolean;
  padding?: number;
  onAdvance: () => void;
}

const buildPath = (rect: DOMRect, padding: number, vw: number, vh: number) => {
  const x = Math.max(0, rect.x - padding);
  const y = Math.max(0, rect.y - padding);
  const w = Math.min(vw - x, rect.width + padding * 2);
  const h = Math.min(vh - y, rect.height + padding * 2);
  // Even-odd fill rule: outer rect then hole rect
  return `M0 0H${vw}V${vh}H0V0Z M${x} ${y}H${x + w}V${y + h}H${x}V${y}Z`;
};

export const GuideSpotlight: React.FC<SpotlightProps> = ({ getCurrentTarget, active, padding = 10, onAdvance }) => {
  const [path, setPath] = useState<string>('');
  const [vw, setVw] = useState<number>(window.innerWidth);
  const [vh, setVh] = useState<number>(window.innerHeight);

  const update = useCallback(() => {
    if (!active) return;
    const el = getCurrentTarget();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPath(buildPath(rect, padding, vw, vh));
  }, [active, getCurrentTarget, padding, vw, vh]);

  useEffect(() => {
    update();
  }, [update]);

  useEffect(() => {
    if (!active) return;
    let raf: number;
    const loop = () => {
      update();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, update]);

  useEffect(() => {
    const handleResize = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
      update();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [update]);

  return (
    <div className={styles.overlayRoot + ' ' + (!active ? styles.hidden : '')} onClick={() => active && onAdvance()}>
      <svg className={styles.svgLayer} width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`}>
        {active && path && (
          <path className={styles.pathMask} d={path} fillRule="evenodd" />
        )}
      </svg>
    </div>
  );
};

export default GuideSpotlight;

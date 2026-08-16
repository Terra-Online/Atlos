import React, { useEffect, useState, useCallback } from 'react';
import styles from './spotlight.module.scss';
import { useAppViewport } from '@/platform/device';

interface SpotlightProps {
  getCurrentTarget: () => Element | null;
  active: boolean;
  padding?: number;
  onAdvance: () => void;
}

const buildPath = (rect: DOMRect, padding: number, vw: number, vh: number) => {
  const x = rect.x - padding;
  const y = rect.y - padding;
  const w = rect.width + padding * 2;
  const h = rect.height + padding * 2;
  // Even-odd fill rule: outer rect then hole rect
  return `M0 0H${vw}V${vh}H0V0Z M${x} ${y}H${x + w}V${y + h}H${x}V${y}Z`;
};

export const GuideSpotlight: React.FC<SpotlightProps> = ({ getCurrentTarget, active, padding = 10, onAdvance }) => {
  const [path, setPath] = useState<string>('');
  const [rect, setRect] = useState<DOMRect | null>(null);
  const { width: vw, height: vh } = useAppViewport();

  const update = useCallback(() => {
    if (!active) return;
    const el = getCurrentTarget();
    if (!el) {
        setRect(null);
        return;
    }
    const r = el.getBoundingClientRect();
    setRect(r);
    setPath(buildPath(r, padding, vw, vh));
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

  return (
    <div className={styles.overlayRoot + ' ' + (!active ? styles.hidden : '')} onClick={() => active && onAdvance()}>
      <svg className={styles.svgLayer} width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`}>
        {active && path && (
          <path className={styles.pathMask} d={path} fillRule="evenodd" />
        )}
      </svg>
      {active && rect && (
        <div
            className={styles.spotlightBox}
            style={{
                left: rect.x - padding,
                top: rect.y - padding,
                width: rect.width + padding * 2,
                height: rect.height + padding * 2,
            }}
        />
      )}
    </div>
  );
};

export default GuideSpotlight;

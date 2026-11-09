import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import IntelCard, { type ArchiveCardProps } from './intelCard';
import styles from './intelCard.module.scss';

interface Props extends ArchiveCardProps {
  virtualize: boolean;
  rootRef: RefObject<HTMLElement | null>;
}

interface PlaceholderStyle extends CSSProperties {
  '--intel-card-expanded-height'?: string;
}

/**
 * Keep the measured card shell in the grid while its expensive translated
 * content is outside the scroll window. The full card remains mounted during
 * expand/collapse transitions; callers temporarily disable virtualization for
 * those transitions.
 */
const VirtualIntelCard = memo(({ virtualize, rootRef, ...card }: Props) => {
  const skeletonRef = useRef<HTMLDivElement | null>(null);
  const [nearby, setNearby] = useState(true);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    // Switching between the full card and its placeholder replaces the
    // observed element, so rebind the observer whenever `nearby` changes.
    if (!virtualize) {
      setNearby(true);
      return undefined;
    }
    const skeleton = skeletonRef.current;
    if (!skeleton || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setNearby(Boolean(entry?.isIntersecting)),
      { root: rootRef.current, rootMargin: '100% 0px' },
    );
    observer.observe(skeleton);
    return () => observer.disconnect();
  }, [nearby, rootRef, virtualize]);

  const setSkeleton = useCallback((element: HTMLDivElement | null) => {
    skeletonRef.current = element;
  }, []);
  const onHeightMeasured = useCallback((next: number) => {
    setHeight((previous) => previous === next ? previous : next);
  }, []);

  if (nearby || !virtualize) {
    // Keep the scroll range stable while the restored card waits for rAF measurement.
    return (
      <IntelCard
        {...card}
        virtualRef={setSkeleton}
        measuredHeight={height ?? undefined}
        onHeightMeasured={onHeightMeasured}
      />
    );
  }

  return (
    <div
      ref={setSkeleton}
      className={styles.cardSkeleton}
      data-intel-archive={card.archive.id}
      data-height-ready={height ? 'true' : undefined}
      style={height ? {
        zIndex: card.stackOrder,
        '--intel-card-expanded-height': `${height}px`,
      } as PlaceholderStyle : { zIndex: card.stackOrder }}
      aria-hidden="true"
    />
  );
});

export default VirtualIntelCard;

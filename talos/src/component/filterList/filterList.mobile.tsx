import React, { useEffect, useRef, useState } from 'react';
import { getItemIconUrl } from '@/utils/resource.ts';
import { useFilter, useSwitchFilter } from '@/store/marker.ts';
import styles from './filterList.module.scss';

interface FilterListMobileProps {
  width?: number | string;
  onContentWidthChange?: (w: number) => void;
}

const FilterListMobile: React.FC<FilterListMobileProps> = ({ width = '100%', onContentWidthChange }) => {
  const filterList = useFilter();
  const switchFilter = useSwitchFilter();
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [showLeftMask, setShowLeftMask] = useState(false);
  const [showRightMask, setShowRightMask] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setShowLeftMask(scrollLeft > 1);
      setShowRightMask(scrollLeft + clientWidth < scrollWidth - 1);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [filterList.length]);

  // Report content width upwards for layout clamping
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      onContentWidthChange?.(el.scrollWidth || el.clientWidth || 0);
    });
    ro.observe(el);
    // initial
    onContentWidthChange?.(el.scrollWidth || el.clientWidth || 0);
    return () => ro.disconnect();
  }, [onContentWidthChange, filterList.length]);

  return (
    <div className={styles.mainFilterList} style={{ width }}>
      <div
        ref={containerRef}
        className={[
          styles.mainFilterContentContainer,
          showLeftMask ? styles.leftMaskOpacity : '',
          showRightMask ? styles.rightMaskOpacity : '',
        ].join(' ')}
        style={{ overflowX: 'auto' }}
      >
        <div ref={innerRef} className={styles.innerContainer} >
          {[...filterList].reverse().map((item) => (
            <span
              key={item}
              className={styles.mainFilterContentItem}
              style={{ backgroundImage: `url(${getItemIconUrl(item)})` }}
              onClick={() => switchFilter(item)}
            />)
          )}
        </div>
      </div>
    </div>
  );
};

export default FilterListMobile;

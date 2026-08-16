import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useScopedBoxSelection } from '@main/component/sideBar/useScopedBoxSelection';
import styles from './boxSelection.module.scss';

interface BoxSelectionProps {
  containerRef: RefObject<HTMLElement | null>;
  itemSelector: string;
  keyAttribute: string;
  activeAttribute?: string;
  getInitialKeys?: () => Iterable<string>;
  onChange: (keys: string[]) => void;
}

const BoxSelection = (props: BoxSelectionProps) => {
  const selectionBoxRef = useRef<HTMLDivElement | null>(null);
  const { isSelecting } = useScopedBoxSelection({ ...props, selectionBoxRef });
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);

  useLayoutEffect(() => {
    if (isSelecting) {
      setVisible(true);
      setFading(false);
      return;
    }
    if (!visible) return;
    const frame = requestAnimationFrame(() => setFading(true));
    const timer = window.setTimeout(() => setVisible(false), 250);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [isSelecting, visible]);

  return (
    <div
      ref={selectionBoxRef}
      className={`${styles.selectionBox} ${visible ? '' : styles.hidden} ${fading ? styles.fadeOut : ''}`}
      aria-hidden="true"
    />
  );
};

export default BoxSelection;

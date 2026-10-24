import { useSelectionVisibility } from '@main/component/selection/useSelectionVisibility';
import { useRef, type RefObject } from 'react';
import { useScopedBoxSelection } from '@main/component/selection/useScopedBoxSelection';
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
  const { visible, fading } = useSelectionVisibility(isSelecting, 250);

  return (
    <div
      ref={selectionBoxRef}
      className={`${styles.selectionBox} ${visible ? '' : styles.hidden} ${fading ? styles.fadeOut : ''}`}
      aria-hidden="true"
    />
  );
};

export default BoxSelection;

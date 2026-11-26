import { useOverlayLayer } from '@/lib/dom/useOverlayLayer';
import { usePresence } from '@/lib/dom/usePresence';
import { useScrollEdges } from '@/lib/dom/useScrollEdges';
import { useFontRegion } from '@/locale/useFontRegion';
import type { FontScope } from '@/locale/fontLoader';
import type { TextRun } from '@/locale/fontShards';
import { memo, useCallback, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import styles from './modal.module.scss';
import { PillButton } from '@/component/button/button';
import { getOpenerDocument, useAppDocument } from '@/platform/pictureInPicture';
import OverflowPopoverText from '@/component/popover/OverflowPopoverText';
import { useTranslateUI } from '@/locale';
import AdaptiveLinearBlur from '@/component/effects/AdaptiveLinearBlur';

export interface ModalProps {
  open: boolean;
  title?: ReactNode;
  icon?: ReactNode;
  iconScale?: number;
  toolbar?: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
  onAfterClose?: () => void;
  onChange?: (open: boolean) => void;
  maskClosable?: boolean;
  showClose?: boolean;
  size?: 's' | 'm' | 'l' | 'full';
  closeOnEsc?: boolean;
  /** Retain the surface through its exit transition. */
  keepMounted?: boolean;
  exitDuration?: number;
  animateOnOpen?: boolean;
  customHeight?: string;
  contentClassName?: string;
  contentRef?: RefObject<HTMLDivElement | null>;
  /** Disable when a nested viewport owns scrolling and its edge effects. */
  scrollFades?: boolean;
  fontRuns?: TextRun[];
  /** Whether this modal blocks the atomic language switch. */
  fontScope?: FontScope;
}

const defaultFontRuns: TextRun[] = [];

const ScrollFades = memo(function ScrollFades({
  targetRef,
  active,
  ownerDocument,
}: {
  targetRef: RefObject<HTMLDivElement | null>;
  active: boolean;
  ownerDocument: Document | null;
}) {
  const { top, bottom } = useScrollEdges({ targetRef, ownerDocument, active });
  if (!top && !bottom) return null;
  return (
    <>
      <AdaptiveLinearBlur
        targetRef={targetRef}
        visible={top}
        side="top"
        strength={2}
        className={`${styles.topBlur} ${top ? styles.visible : ''}`}
      />
      <AdaptiveLinearBlur
        targetRef={targetRef}
        visible={bottom}
        side="bottom"
        strength={2}
        className={`${styles.bottomBlur} ${bottom ? styles.visible : ''}`}
      />
    </>
  );
});

export default function Modal({
  fontRuns = defaultFontRuns,
  fontScope = 'critical',
  open,
  title,
  icon,
  iconScale = 1,
  toolbar,
  children,
  onClose,
  onAfterClose,
  onChange,
  maskClosable = true,
  showClose = true,
  size = 's',
  closeOnEsc = true,
  keepMounted = true,
  exitDuration = 325,
  animateOnOpen = true,
  customHeight,
  contentClassName,
  contentRef,
  scrollFades = true,
}: ModalProps) {
  const tUI = useTranslateUI();
  const appDocument = useAppDocument();
  const ownerDocument = size === 'full' && appDocument ? getOpenerDocument() : appDocument;
  const { present, visible } = usePresence({
    open, exitDuration, animateOnOpen, retainOnExit: keepMounted, onAfterClose, ownerDocument,
  });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const maskRef = useRef<HTMLDivElement | null>(null);
  const localContentRef = useRef<HTMLDivElement | null>(null);
  const scroller = contentRef ?? localContentRef;
  const titleId = useId();
  const titleText = typeof title === 'string' ? title : '';
  const fontRef = useFontRegion([
    { faces: ['db'], text: titleText, localized: 'ui' },
    { faces: ['h', 'r'], text: '' },
    ...fontRuns,
  ], { scope: fontScope });
  const setDialogRef = useCallback((element: HTMLDivElement | null) => {
    dialogRef.current = element;
    fontRef(element);
  }, [fontRef]);
  const dismiss = () => {
    onClose?.();
    onChange?.(false);
  };
  const { isTop } = useOverlayLayer({
    present, ownerDocument, active: open, elementRef: maskRef, focusRef: dialogRef,
    modal: true, closeOnEscape: closeOnEsc, onDismiss: dismiss,
  });

  if (!present || typeof document === 'undefined') return null;
  const state = visible ? 'open' : 'closed';
  return createPortal(
    <div
      className={styles.modalMask}
      data-state={state}
      ref={maskRef}
      onClick={() => { if (maskClosable && open && isTop()) dismiss(); }}
    >
      <div
        data-font-region="modal"
        className={styles.modalContainer}
        data-size={size}
        data-state={state}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        ref={setDialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        {(title || icon || showClose) && (
          <div className={styles.modalHeader}>
            {icon && <span className={styles.modalIcon} style={{ transform: `scale(${iconScale})` }}>{icon}</span>}
            {title && (titleText
              ? <OverflowPopoverText id={titleId} text={titleText} className={styles.modalTitle} element="div" />
              : <div id={titleId} className={styles.modalTitle}>{title}</div>
            )}
            {showClose && <PillButton onClick={dismiss}>{tUI('common.close')}</PillButton>}
          </div>
        )}
        {toolbar}
        <div
          className={[styles.modalContent, contentClassName].filter(Boolean).join(' ')}
          ref={scroller}
          style={customHeight ? { maxHeight: customHeight } : undefined}
        >
          {children}
        </div>
        {scrollFades && <ScrollFades targetRef={scroller} active={open} ownerDocument={ownerDocument} />}
      </div>
    </div>,
    ownerDocument?.body ?? document.body,
  );
}

import React, { useEffect, useRef, useState, useId, useCallback } from 'react';
import ReactDOM from 'react-dom';
import styles from './modal.module.scss'; 
import Button from '@/component/button/button';

import { useTranslateUI } from '@/locale';
import { LinearBlur } from 'progressive-blur';

export interface ModalProps {
  open: boolean;
  title?: React.ReactNode;
  /** image slot before title */
  icon?: React.ReactNode;
  children?: React.ReactNode;
  onClose?: () => void; // close callback
  onChange?: (open: boolean) => void; // switch state change callback
  maskClosable?: boolean;
  showClose?: boolean; // show close button on the header
  size?: 's' | 'm' | 'l' | 'full';
  closeOnEsc?: boolean;
  keepMounted?: boolean; // whether to keep the node when closing (for animation exit)
  /** exit animation duration in milliseconds, must correspond with CSS */
  exitDuration?: number;
  /** whether to play enter animation on first / every open (triggered by first frame closed -> open) */
  animateOnOpen?: boolean;
}

const FOCUS_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const Modal: React.FC<ModalProps> = ({
  open,
  title,
  icon,
  children,
  onClose,
  onChange,
  maskClosable = true,
  showClose = true,
  size = 's',
  closeOnEsc = true,
  keepMounted = true,
  exitDuration = 300,
  animateOnOpen = true,
}) => {
  const tUI = useTranslateUI();
  /**
   * Lifecycle phases:
   * 'unmounted' -> 'entering' -> 'open' -> 'exiting' -> 'unmounted'
   * entering: first frame data-state=closed, next frame switch to open triggers transition
   * exiting: data-state=closed, wait for CSS animation to end before unmounting
   */
  type Phase = 'unmounted' | 'entering' | 'open' | 'exiting';
  const [phase, setPhase] = useState<Phase>(() => (open ? (animateOnOpen ? 'entering' : 'open') : 'unmounted'));
  const prevActiveRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const maskRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  
  // Track scroll position for blur effects
  const [isScrolledTop, setIsScrolledTop] = useState(true);
  const [isScrolledBottom, setIsScrolledBottom] = useState(true);

  // When open becomes true, mount; when it becomes false, trigger exit animation
  useEffect(() => {
    if (open) {
      if (phase === 'unmounted') {
        setPhase(animateOnOpen ? 'entering' : 'open');
      } else if (phase === 'exiting') {
        // if reverting during exit, go to open directly
        setPhase(animateOnOpen ? 'entering' : 'open');
      }
    } else {
      if (phase === 'open') {
        if (keepMounted) {
          setPhase('exiting');
        } else {
          setPhase('unmounted');
        }
      } else if (phase === 'entering') {
        // unmount directly if closing during entering
        setPhase('unmounted');
      }
    }
  }, [open, phase, animateOnOpen, keepMounted]);

  // entering -> open switch on next frame
  useEffect(() => {
    if (phase === 'entering') {
      const raf = requestAnimationFrame(() => setPhase('open'));
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [phase]);

  // exiting -> unmounted after exitDuration
  useEffect(() => {
    if (phase === 'exiting') {
      const timer = window.setTimeout(() => setPhase('unmounted'), exitDuration);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [phase, exitDuration]);

  useEffect(() => { onChange?.(open); }, [open, onChange]);

  // Track scroll position for blur effects
  useEffect(() => {
    const scroller = contentRef.current;
    if (!scroller) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scroller;
      setIsScrolledTop(scrollTop <= 1);
      setIsScrolledBottom(scrollTop + clientHeight >= scrollHeight - 1);
    };

    handleScroll(); // Initial check
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    
    // Also check on content changes
    const resizeObserver = new ResizeObserver(handleScroll);
    resizeObserver.observe(scroller);
    
    return () => {
      scroller.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    };
  }, [phase]); // Re-run when modal opens/closes

  // Ensure all hooks have run before doing environment checks
  const isSSR = typeof document === 'undefined';

  // Focus management & focus container on enter
  useEffect(() => {
    if (open) {
      prevActiveRef.current = document.activeElement as HTMLElement | null;
      const raf = requestAnimationFrame(() => {
        dialogRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    } else if (!open && prevActiveRef.current) {
      prevActiveRef.current.focus?.();
    }
    return undefined;
  }, [open]);

  // keyboard support
  useEffect(() => {
    if (!open || !closeOnEsc) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.();
        onChange?.(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, closeOnEsc, onClose, onChange]);

  // escape key focus trap
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const container = dialogRef.current;
    if (!container) return;
    const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUS_SELECTOR))
      .filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1);
    if (nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    }
  }, []);

  // Ensure all hooks have run before doing environment checks
  if (isSSR || phase === 'unmounted') return null;

  const handleMaskClick = () => {
    if (!maskClosable) return;
    onClose?.();
    onChange?.(false);
  };

  const root = document.body;
  return ReactDOM.createPortal(
    <div
      className={styles.modalMask}
  data-state={phase === 'open' ? 'open' : 'closed'}
      onClick={handleMaskClick}
      ref={maskRef}
    >
      <div
        className={styles.modalContainer}
        data-size={size}
        data-state={phase === 'open' ? 'open' : 'closed'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || icon || showClose) && (
          <div className={styles.modalHeader}>
            {icon && <span className={styles.modalIcon}>{icon}</span>}
            {title && <div id={titleId} className={styles.modalTitle}>{title}</div>}
            {showClose && (
              <Button
                text={tUI('common.close')}
                aria-label={tUI('common.close') || 'Close'}
                buttonType='close'
                onClick={() => {
                  onClose?.();
                  onChange?.(false);
                }}
              />
            )}
          </div>
        )}
        <div className={styles.modalContent} ref={contentRef}>{children}</div>
        
        {/* Top blur: visible when not scrolled to top */}
        <LinearBlur
          side='top'
          strength={2}
          className={`${styles.topBlur} ${!isScrolledTop ? styles.visible : ''}`}
        />
        
        {/* Bottom blur: visible when not scrolled to bottom */}
        <LinearBlur
          side='bottom'
          strength={2}
          className={`${styles.bottomBlur} ${!isScrolledBottom ? styles.visible : ''}`}
        />
      </div>
    </div>,
    root,
  );
};

export default Modal;

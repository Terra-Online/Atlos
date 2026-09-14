import React, {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import ReactDOM from 'react-dom';
import styles from './modal.module.scss';
import Button from '@/component/button/button';
import { getOpenerDocument, getPictureInPictureDocument } from '@/component/scale/pip';
import OverflowPopoverText from '@/component/popover/OverflowPopoverText';
import PopoverTooltip from '@/component/popover/popover';

import { useTranslateUI } from '@/locale';
import AdaptiveLinearBlur from '@/component/effects/AdaptiveLinearBlur';

export interface ModalTabItem {
  key: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  disabled?: boolean;
}

export interface ModalQuickAction {
  icon: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

export interface ModalTabsProps {
  items: ModalTabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  quickAction?: ModalQuickAction;
  ariaLabel?: string;
  className?: string;
  swipeTargetRef?: React.RefObject<HTMLElement | null>;
}

interface TabTouchGesture {
  identifier: number;
  startX: number;
  startY: number;
  startCenter: number;
  indicatorLeft: number;
  intent: 'pending' | 'horizontal' | 'vertical';
}

const TAB_INDICATOR_SETTLE_MS = 400;

export const ModalTabs = forwardRef<HTMLDivElement, ModalTabsProps>(({
  items,
  activeKey,
  onChange,
  quickAction,
  ariaLabel,
  className,
  swipeTargetRef,
}, forwardedRef) => {
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const touchGestureRef = useRef<TabTouchGesture | null>(null);
  const indicatorResetTimerRef = useRef<number | undefined>(undefined);
  const [indicatorLeft, setIndicatorLeft] = useState<number | null>(null);
  const [isSwiping, setIsSwiping] = useState(false);

  useImperativeHandle(forwardedRef, () => tabsRef.current as HTMLDivElement);

  const getTabCenter = useCallback((key: string): number | null => {
    const tabs = tabsRef.current;
    const tab = tabRefs.current.get(key);
    if (!tabs || !tab) return null;
    const tabsRect = tabs.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    return tabRect.left - tabsRect.left + tabs.scrollLeft + tabRect.width / 2;
  }, []);

  const syncIndicator = useCallback(() => {
    setIndicatorLeft(getTabCenter(activeKey));
  }, [activeKey, getTabCenter]);

  useLayoutEffect(() => {
    syncIndicator();
  }, [items.length, syncIndicator]);

  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return undefined;

    const frame = window.requestAnimationFrame(syncIndicator);
    const handleLayoutChange = () => syncIndicator();
    window.addEventListener('resize', handleLayoutChange);
    tabs.addEventListener('scroll', handleLayoutChange, { passive: true });

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(handleLayoutChange);
    resizeObserver?.observe(tabs);
    tabRefs.current.forEach((tab) => resizeObserver?.observe(tab));

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleLayoutChange);
      tabs.removeEventListener('scroll', handleLayoutChange);
      resizeObserver?.disconnect();
    };
  }, [items.length, syncIndicator]);

  useEffect(() => {
    const swipeTarget = swipeTargetRef?.current;
    if (!swipeTarget || items.length < 2) return undefined;

    const findTouch = (touches: TouchList, identifier: number): Touch | null => {
      for (let index = 0; index < touches.length; index += 1) {
        const touch = touches.item(index);
        if (touch?.identifier === identifier) return touch;
      }
      return null;
    };

    const availableItems = () => items.filter((item) => !item.disabled);
    const availableCenters = () => availableItems()
      .map((item) => ({ item, center: getTabCenter(item.key) }))
      .filter((entry): entry is { item: ModalTabItem; center: number } => entry.center !== null);

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches.item(0);
      const center = getTabCenter(activeKey);
      if (!touch || center === null) return;
      if (indicatorResetTimerRef.current) window.clearTimeout(indicatorResetTimerRef.current);
      touchGestureRef.current = {
        identifier: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        startCenter: center,
        indicatorLeft: center,
        intent: 'pending',
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const gesture = touchGestureRef.current;
      if (!gesture) return;
      const touch = findTouch(event.touches, gesture.identifier);
      if (!touch) return;
      const movementX = touch.clientX - gesture.startX;
      const movementY = touch.clientY - gesture.startY;

      if (gesture.intent === 'pending') {
        if (Math.max(Math.abs(movementX), Math.abs(movementY)) < 10) return;
        gesture.intent = Math.abs(movementX) > Math.abs(movementY) * 1.15
          ? 'horizontal'
          : 'vertical';
      }
      if (gesture.intent !== 'horizontal') return;

      const centers = availableCenters().map((entry) => entry.center);
      if (centers.length < 2) return;
      gesture.indicatorLeft = Math.max(
        Math.min(...centers),
        Math.min(Math.max(...centers), gesture.startCenter - movementX),
      );
      setIsSwiping(true);
      setIndicatorLeft(gesture.indicatorLeft);
    };

    const finishTouch = (event: TouchEvent, allowSwitch: boolean) => {
      const gesture = touchGestureRef.current;
      if (!gesture || findTouch(event.changedTouches, gesture.identifier) === null) return;
      touchGestureRef.current = null;
      setIsSwiping(false);

      const centers = availableCenters();
      const closest = centers.reduce<typeof centers[number] | null>((match, entry) => {
        if (!match) return entry;
        return Math.abs(entry.center - gesture.indicatorLeft) < Math.abs(match.center - gesture.indicatorLeft)
          ? entry
          : match;
      }, null);
      const shouldSwitch = allowSwitch
        && gesture.intent === 'horizontal'
        && closest
        && closest.item.key !== activeKey
        && Math.abs(gesture.indicatorLeft - gesture.startCenter) >= 24;
      const settledKey = shouldSwitch && closest ? closest.item.key : activeKey;
      setIndicatorLeft(getTabCenter(settledKey));
      if (shouldSwitch) onChange(settledKey);

      indicatorResetTimerRef.current = window.setTimeout(() => {
        syncIndicator();
        indicatorResetTimerRef.current = undefined;
      }, TAB_INDICATOR_SETTLE_MS);
    };

    const handleTouchEnd = (event: TouchEvent) => finishTouch(event, true);
    const handleTouchCancel = (event: TouchEvent) => finishTouch(event, false);
    swipeTarget.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    swipeTarget.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true });
    swipeTarget.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
    swipeTarget.addEventListener('touchcancel', handleTouchCancel, { capture: true, passive: true });

    return () => {
      swipeTarget.removeEventListener('touchstart', handleTouchStart, true);
      swipeTarget.removeEventListener('touchmove', handleTouchMove, true);
      swipeTarget.removeEventListener('touchend', handleTouchEnd, true);
      swipeTarget.removeEventListener('touchcancel', handleTouchCancel, true);
      touchGestureRef.current = null;
    };
  }, [activeKey, getTabCenter, items, onChange, swipeTargetRef, syncIndicator]);

  useEffect(() => () => {
    if (indicatorResetTimerRef.current) window.clearTimeout(indicatorResetTimerRef.current);
  }, []);

  if (items.length === 0) return null;

  const quickActionButton = quickAction ? (
    <button
      type="button"
      className={[
        styles.modalQuickAction,
        quickAction.disabled ? styles.disabled : '',
        quickAction.active ? styles.confirming : '',
      ].filter(Boolean).join(' ')}
      aria-label={typeof quickAction.label === 'string' ? quickAction.label : undefined}
      disabled={quickAction.disabled}
      data-confirming={quickAction.active ? 'true' : 'false'}
      onClick={quickAction.onClick}
    >
      {quickAction.icon}
    </button>
  ) : null;

  return (
    <div
      className={[styles.modalTabs, className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={ariaLabel}
      data-active-tab={activeKey}
      data-has-quick-action={quickAction ? 'true' : 'false'}
      data-swiping={isSwiping ? 'true' : 'false'}
      ref={tabsRef}
      style={{
        '--modal-tab-count': items.length,
        '--modal-tab-indicator-left': indicatorLeft === null ? undefined : `${indicatorLeft}px`,
      } as React.CSSProperties}
    >
      {quickAction && (
        typeof quickAction.label === 'string' ? (
          <PopoverTooltip content={quickAction.label} placement="top" gap={4}>
            {quickActionButton as React.ReactElement}
          </PopoverTooltip>
        ) : quickActionButton
      )}
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={styles.modalTab}
          role="tab"
          aria-selected={activeKey === item.key}
          disabled={item.disabled}
          data-tab={item.key}
          ref={(element) => {
            if (element) tabRefs.current.set(item.key, element);
            else tabRefs.current.delete(item.key);
          }}
          onClick={() => onChange(item.key)}
        >
          {item.icon}
          <span>{item.title}</span>
        </button>
      ))}
    </div>
  );
});

ModalTabs.displayName = 'ModalTabs';

export interface ModalProps {
  open: boolean;
  title?: React.ReactNode;
  /** image slot before title */
  icon?: React.ReactNode;
  iconScale?: number; // scale for the icon, use when you need visual optimization
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
  customHeight?: string; // custom modal height, e.g. '400px' or '50vh'
  tabs?: ModalTabItem[];
  activeTabKey?: string;
  onTabChange?: (key: string) => void;
  quickAction?: ModalQuickAction;
  tabsAriaLabel?: string;
  contentClassName?: string;
}

const FOCUS_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const getModalDocument = (size: ModalProps['size']) => {
  if (typeof document === 'undefined') return null;
  if (size !== 'full') return getPictureInPictureDocument() ?? document;
  return getOpenerDocument() ?? document;
};

const Modal: React.FC<ModalProps> = ({
  open,
  title,
  icon,
  iconScale = 1,
  children,
  onClose,
  onChange,
  maskClosable = true,
  showClose = true,
  size = 's',
  closeOnEsc = true,
  keepMounted = true,
  exitDuration = 325,
  animateOnOpen = true,
  customHeight,
  tabs = [],
  activeTabKey,
  onTabChange,
  quickAction,
  tabsAriaLabel,
  contentClassName,
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
    const ownerDocument = getModalDocument(size);
    if (!ownerDocument) return undefined;
    if (open) {
      prevActiveRef.current = ownerDocument.activeElement as HTMLElement | null;
      const raf = requestAnimationFrame(() => {
        dialogRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    } else if (!open && prevActiveRef.current) {
      prevActiveRef.current.focus?.();
    }
    return undefined;
  }, [open, size]);

  // keyboard support
  useEffect(() => {
    if (!open || !closeOnEsc) return undefined;
    const ownerWindow = getModalDocument(size)?.defaultView ?? window;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.();
        onChange?.(false);
      }
    };
    ownerWindow.addEventListener('keydown', onKey);
    return () => {
      ownerWindow.removeEventListener('keydown', onKey);
    };
  }, [open, closeOnEsc, onClose, onChange, size]);

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
    const active = container.ownerDocument.activeElement as HTMLElement | null;
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

  const root = getModalDocument(size)?.body ?? document.body;
  const titleText = typeof title === 'string' ? title : '';
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
            {icon && <span className={styles.modalIcon} style={{ transform: `scale(${iconScale})` }}>{icon}</span>}
            {title && (
              titleText ? (
                <OverflowPopoverText
                  id={titleId}
                  text={titleText}
                  className={styles.modalTitle}
                  element="div"
                />
              ) : (
                <div id={titleId} className={styles.modalTitle}>{title}</div>
              )
            )}
            {showClose && (
              <Button
                text={tUI('common.close')}
                aria-label={tUI('common.close')}
                buttonType='close'
                onClick={() => {
                  onClose?.();
                  onChange?.(false);
                }}
              />
            )}
          </div>
        )}
        {tabs.length > 0 && activeTabKey && onTabChange && (
          <ModalTabs
            items={tabs}
            activeKey={activeTabKey}
            onChange={onTabChange}
            quickAction={quickAction}
            ariaLabel={tabsAriaLabel}
            swipeTargetRef={contentRef}
          />
        )}
        <div
          className={[styles.modalContent, contentClassName].filter(Boolean).join(' ')}
          ref={contentRef}
          style={customHeight ? { maxHeight: customHeight } : undefined}
        >
          {children}
        </div>
        
        {/* Top blur: visible when not scrolled to top */}
        {tabs.length === 0 && (
          <AdaptiveLinearBlur
            side='top'
            strength={2}
            className={`${styles.topBlur} ${!isScrolledTop ? styles.visible : ''}`}
          />
        )}
        
        {/* Bottom blur: visible when not scrolled to bottom */}
        <AdaptiveLinearBlur
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

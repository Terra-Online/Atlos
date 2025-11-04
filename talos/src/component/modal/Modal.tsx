import React, { useEffect, useRef, useState, useId, useCallback } from 'react';
import { useTranslateUI } from '@/locale';
import ReactDOM from 'react-dom';
import styles from './modal.module.scss';
import { LinearBlur } from 'progressive-blur';

export interface ModalProps {
  open: boolean;
  title?: React.ReactNode;
  /** 标题前的图标插槽 */
  icon?: React.ReactNode;
  children?: React.ReactNode;
  onClose?: () => void; // 关闭时回传
  onChange?: (open: boolean) => void; // 开关状态变化回传
  maskClosable?: boolean;
  showClose?: boolean; // 是否在 header 右侧显示关闭按钮
  size?: 's' | 'm' | 'l' | 'full';
  closeOnEsc?: boolean;
  keepMounted?: boolean; // 是否在关闭时保留节点（用于动画退出）
  /** 退出动画的毫秒时长，需与 CSS 对应 */
  exitDuration?: number;
  /** 首次 / 每次打开时是否播放进入动画（通过首帧 closed -> open 触发） */
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
   * 状态机：
   * 'unmounted' -> 'entering' -> 'open' -> 'exiting' -> 'unmounted'
   * entering: 首帧 data-state=closed，下一帧切 open 触发过渡
   * exiting: data-state=closed，等待 CSS 动画结束后卸载
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

  // 当 open 变为 true 时挂载；变为 false 时触发退出动画
  useEffect(() => {
    if (open) {
      if (phase === 'unmounted') {
        setPhase(animateOnOpen ? 'entering' : 'open');
      } else if (phase === 'exiting') {
        // 打开过程中立即反向：重新进入
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
        // 尚未到 open 就关闭，直接卸载
        setPhase('unmounted');
      }
    }
  }, [open, phase, animateOnOpen, keepMounted]);

  // entering -> open 下一帧
  useEffect(() => {
    if (phase === 'entering') {
      const raf = requestAnimationFrame(() => setPhase('open'));
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [phase]);

  // exiting -> unmounted 等待动画时间
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

  // 保证所有 hooks 已调用后再做环境判定
  const isSSR = typeof document === 'undefined';

  // 焦点保存 & 进入时聚焦容器
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

  // ESC 关闭
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

  // 焦点陷阱
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

  // 在所有 hooks 之后才根据 present 决定渲染，避免条件 hook 违规
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
              <button
                type="button"
                aria-label={(tUI('common.close') as unknown as string) || 'Close'}
                className={styles.modalClose}
                onClick={() => {
                  onClose?.();
                  onChange?.(false);
                }}
              >
                <span className={styles.deco}></span>
                <span className={styles.closeText}>{tUI('common.close') as unknown as string}</span>
              </button>
            )}
          </div>
        )}
        <div className={styles.modalContent} ref={contentRef}>{children}</div>
        
        {/* Top blur: visible when not scrolled to top */}
        <LinearBlur
          side='top'
          strength={4}
          className={`${styles.topBlur} ${!isScrolledTop ? styles.visible : ''}`}
        />
        
        {/* Bottom blur: visible when not scrolled to bottom */}
        <LinearBlur
          side='bottom'
          strength={4}
          className={`${styles.bottomBlur} ${!isScrolledBottom ? styles.visible : ''}`}
        />
      </div>
    </div>,
    root,
  );
};

export default Modal;

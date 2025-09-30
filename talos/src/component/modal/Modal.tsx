import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import styles from './modal.module.scss';

export interface ModalProps {
  open: boolean;
  title?: React.ReactNode;
  children?: React.ReactNode;
  onClose?: () => void; // 关闭时回传
  onChange?: (open: boolean) => void; // 开关状态变化回传
  onConfirm?: () => void; // 确认动作
  footer?: React.ReactNode; // 自定义底部
  maskClosable?: boolean;
}

const Modal: React.FC<ModalProps> = ({
  open,
  title,
  children,
  onClose,
  onChange,
  onConfirm,
  footer,
  maskClosable = true,
}) => {
  useEffect(() => {
    onChange?.(open);
  }, [open, onChange]);

  if (typeof document === 'undefined') return null;
  const root = document.body;

  if (!open) return null;

  const handleMaskClick = () => {
    if (!maskClosable) return;
    onClose?.();
    onChange?.(false);
  };

  return ReactDOM.createPortal(
    <div className={styles.modalMask} onClick={handleMaskClick}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {title && <div className={styles.header}>{title}</div>}
        <div className={styles.content}>{children}</div>
        {footer !== undefined ? (
          <div className={styles.footer}>{footer}</div>
        ) : (
          <div className={styles.footer}>
            <button className={styles.btn} onClick={onClose}>Cancel</button>
            {onConfirm && (
              <button className={`${styles.btn} ${styles.primary}`} onClick={onConfirm}>
                OK
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    root,
  );
};

export default Modal;

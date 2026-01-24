import React from 'react';
import Modal from '@/component/modal/modal';
import { useTranslateUI } from '@/locale';
import styles from './support.module.scss';

export interface SupportProps {
  open: boolean;
  onClose: () => void;
  onChange?: (open: boolean) => void;
}

const SupportModal: React.FC<SupportProps> = ({ open, onClose, onChange }) => {
  const t = useTranslateUI();

  return (
    <Modal
      open={open}
      size="m"
      onClose={onClose}
      onChange={onChange}
      title={t('support.title')}
    >
      <div className={styles.supportContainer}>
        {/* Support content will be added later */}
      </div>
    </Modal>
  );
};

export default React.memo(SupportModal);

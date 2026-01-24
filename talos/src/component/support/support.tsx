import React from 'react';
import Modal from '@/component/modal/modal';
import { useTranslateUI } from '@/locale';
import styles from './support.module.scss';

import Support from '@/assets/images/UI/support.svg?react'

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
      icon={<Support aria-hidden="true" />}
      iconScale={0.75}
    >
      <div className={styles.supportContainer}>
        呜呜，我想吃麦当劳。
        TAT
      </div>
    </Modal>
  );
};

export default React.memo(SupportModal);

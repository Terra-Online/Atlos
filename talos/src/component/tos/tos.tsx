import React from 'react';
import Modal from '@/component/modal/modal';
import ToSIcon from '../../assets/logos/tos.svg?react';
import styles from './tos.module.scss';
import { useTranslateUI } from '@/locale';

export interface ToSProps {
  open: boolean;
  onClose: () => void;
  onChange?: (open: boolean) => void;
}

const TOSModal: React.FC<ToSProps> = ({ open, onClose, onChange }) => {
  const t = useTranslateUI();

  return (
    <Modal
      open={open}
      size="full"
      onClose={onClose}
      onChange={onChange}
      title={t('storage.title')}
      icon={<ToSIcon aria-hidden="true" />}
    >
      <div className={styles.storageContainer}>
        <div className={styles.policyContainer}>
          <p>{t('storage.policy.intro')}</p>
          <p>{t('storage.policy.impact')}</p>
          <p>{t('storage.policy.privacy')}</p>
          <p>{t('storage.policy.decision')}</p>
        </div>
      </div>
    </Modal>
  );
};

export default React.memo(TOSModal);
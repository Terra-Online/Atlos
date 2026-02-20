import React from 'react';
import Modal from '@/component/modal/modal';
import { useTranslateUI } from '@/locale';
import styles from './support.module.scss';
import parse from 'html-react-parser';
import Button from '@/component/button/button';
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
      size="l"
      onClose={onClose}
      onChange={onChange}
      title={t('support.title')}
      icon={<Support aria-hidden="true" />}
      iconScale={0.75}
    >
      <div className={styles.supportContainer}>
        <div className={styles.beforeYouSupport}>{parse(t('support.content'))}</div>
        <div className={styles.supportLinks}>
          <Button
            text={t('support.patreon')}
            buttonStyle="square"
            width="12rem"
            height="3rem"
            schema="light"
            onClick={() => window.open('https://www.patreon.com/cirisus/', '_blank', 'noopener,noreferrer')}
          />
          <Button
            text={t('support.kofi')}
            buttonStyle="square"
            width="12rem"
            height="3rem"
            schema="light"
            onClick={() => window.open('https://ko-fi.com/cirisus', '_blank', 'noopener,noreferrer')}
          />
          <Button
            text={t('support.afdian')}
            buttonStyle="square"
            width="12rem"
            height="3rem"
            schema="light"
            onClick={() => window.open('https://afdian.com/a/cirisus', '_blank', 'noopener,noreferrer')}
          />
        </div>
        <div className={styles.afterYouSupport}>{parse(t('support.hint'))}</div>
      </div>
    </Modal>
  );
};

export default React.memo(SupportModal);

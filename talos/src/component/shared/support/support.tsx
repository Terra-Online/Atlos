import React from 'react';
import Modal from '@/component/modal/modal';
import { useTranslateUI } from '@/locale';
import styles from '@/component/shared/support/support.module.scss';
import parse from 'html-react-parser';
import { SquareButton } from '@/component/button/button';
import Support from '@/assets/logos/support.svg?react';

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
          <SquareButton onClick={() => window.open('https://www.patreon.com/cirisus/', '_blank', 'noopener,noreferrer')}>
            {t('support.patreon')}
          </SquareButton>
          <SquareButton onClick={() => window.open('https://ko-fi.com/cirisus', '_blank', 'noopener,noreferrer')}>
            {t('support.kofi')}
          </SquareButton>
          <SquareButton onClick={() => window.open('https://afdian.com/a/cirisus', '_blank', 'noopener,noreferrer')}>
            {t('support.afdian')}
          </SquareButton>
        </div>
        <div className={styles.afterYouSupport}>{parse(t('support.hint'))}</div>
      </div>
    </Modal>
  );
};

export default React.memo(SupportModal);

import React, { useMemo } from 'react';
import Modal from '@/component/modal/Modal';
import I18nIcon from '../../asset/logos/i18n.svg?react';
import styles from './language.module.scss';
import { SUPPORTED_LANGS, setLocale, useLocale } from '@/locale';
import { useTranslateUI } from '@/locale';

export interface LanguageModalProps {
  open: boolean;
  onClose: () => void;
  onChange?: (open: boolean) => void;
  onSelected?: (lang: string) => void; // 选中语言、已切换后回传
}

const LANG_LABEL_KEYS: Record<string, string> = {
  'en-us': 'English',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
};

const LanguageModal: React.FC<LanguageModalProps> = ({ open, onClose, onChange, onSelected }) => {
  const current = useLocale();
  const t = useTranslateUI();
  const items = useMemo(() => SUPPORTED_LANGS.map(l => ({ key: l, label: LANG_LABEL_KEYS[l] || l })), []);

  const handlePick = async (lang: string) => {
    await setLocale(lang);
    onSelected?.(lang);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      onChange={onChange}
      title={t('language.title') as unknown as string}
      icon={<I18nIcon aria-hidden="true" />}
    >
      <div className={styles.langList}>
        {items.map(it => (
          <button
            key={it.key}
            className={`${styles.langItem} ${current === it.key ? styles.active : ''}`}
            onClick={() => { void handlePick(it.key); }}
          >
            <span className={styles.langName}>{t(`language.names.${it.key}`) || it.label}</span>
            {current === it.key && <span className={styles.badge}>{t('language.current')}</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
};

export default LanguageModal;

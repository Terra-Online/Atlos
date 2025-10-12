import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Modal from '@/component/modal/Modal';
import I18nIcon from '../../assets/logos/i18n.svg?react';
import styles from './language.module.scss';
import { SUPPORTED_LANGS, setLocale, useLocale } from '@/locale';
import { useTranslateUI } from '@/locale';

export interface LanguageModalProps {
  open: boolean;
  onClose: () => void;
  onChange?: (open: boolean) => void;
  onSelected?: (lang: string) => void;
}

const LANG_LABEL_KEYS: Record<string, string> = {
  'en-us': 'English',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
};

// Convert possible locale like "en-us" to canonical BCP-47 casing: "en-US"
const toBCP47 = (tag: string) => {
  const [lang, region] = tag.split('-');
  return region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase();
};

// Map locale to short region tag displayed at right
const toLangCode = (lang: string) => {
  const lower = lang.toLowerCase();
  if (lower.startsWith('zh-tw') || lower.startsWith('zh-hk')) return 'HK';
  if (lower.startsWith('zh-cn') || lower.startsWith('zh-hans')) return 'CN';// for HK only
  const base = (lower.split('-')[0] || lower).slice(0, 2);
  return base.toUpperCase();
};

// Match the currentLang transition duration in CSS
const FREEZE_MS = 400;

const LanguageModal: React.FC<LanguageModalProps> = ({ open, onClose, onChange, onSelected }) => {
  const current = useLocale();
  const t: (k: string) => string = useTranslateUI();
  const items = useMemo(() => SUPPORTED_LANGS.map(l => ({ key: l, label: LANG_LABEL_KEYS[l] || l })), []);
  const groupId = useId();
  
  // freeze last active current lang, avoiding flicker when switching langs
  const [freeze, setFreeze] = useState<{ from: string; currentText: string } | null>(null);
  const freezeTimerRef = useRef<number | null>(null);

  const handlePick = useCallback(async (lang: string) => {
    if (!lang || lang === current) return;
    // record last-actived
    const prevKey = current;
  const prevCurrentText = t('language.current');
    setFreeze({ from: prevKey, currentText: prevCurrentText });
    if (freezeTimerRef.current) {
      window.clearTimeout(freezeTimerRef.current);
      freezeTimerRef.current = null;
    }
    await setLocale(lang);
    onSelected?.(lang);
    freezeTimerRef.current = window.setTimeout(() => {
      setFreeze(null);
      freezeTimerRef.current = null;
    }, FREEZE_MS);
  }, [current, t, onSelected]);
  useEffect(() => () => {
    if (freezeTimerRef.current) window.clearTimeout(freezeTimerRef.current);
  }, []);

  return (
    <Modal
      open={open}
      size="m"
      onClose={onClose}
      onChange={onChange}
  title={t('language.title')}
      icon={<I18nIcon aria-hidden="true" />}
    >
      <div
        className={styles.langList}
        role="radiogroup"
  aria-label={t('language.title')}
        id={groupId}
      >
        {items.map(it => (
          <button
            key={it.key}
            type="button"
            className={`${styles.langItem} ${current === it.key ? styles.active : ''}`}
            onClick={() => { void handlePick(it.key); }}
            role="radio"
            aria-checked={current === it.key}
            aria-label={t(`language.names.${it.key}`) || (LANG_LABEL_KEYS[it.key] || it.key)}
          >
            <div 
              className={styles.langOrigin}
              lang={toBCP47(it.key)}>
                {it.label}
            </div>
            <div className={styles.langDisplay}>
              {t(`language.names.${it.key}`) || it.label}
            </div>
            <div className={styles.langTag}>
              {toLangCode(it.key)}
              <span className={styles.currentLang} lang={toBCP47(it.key)}>
                {freeze && it.key === freeze.from
                  ? freeze.currentText
                  : t('language.current')}
              </span>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
};

export default React.memo(LanguageModal);

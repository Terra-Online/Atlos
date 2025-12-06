import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Modal from '@/component/modal/modal';
import I18nIcon from '../../assets/logos/i18n.svg?react';
import styles from './language.module.scss';
import { FULL_LANGS, UI_ONLY_LANGS, setLocale, useLocale } from '@/locale';
import { useTranslateUI } from '@/locale';

export interface LanguageProps {
  open: boolean;
  onClose: () => void;
  onChange?: (open: boolean) => void;
  onSelected?: (lang: string) => void;
}

const LANG_LABEL_KEYS: Record<string, string> = {
  'en-US': 'English',
  'zh-CN': '简体中文',
  'zh-HK': '繁體中文',
  'ja-JP': '日本語',
  'ko-KR': '한국어',

  'fr-FR': 'Français',
  'de-DE': 'Deutsch',
  'it-IT': 'Italiano',
  'es-ES': 'Español',
  'ru-RU': 'Русский',
  'pt-BR': 'Português',
  'id-ID': 'Bahasa Indonesia',
  'ar-AE': 'العربية',
  'th-TH': 'ไทย',
  'vi-VN': 'Tiếng Việt',
};

// Convert possible locale like "en-us" to canonical BCP-47 casing: "en-US"
const toBCP47 = (tag: string) => {
  const [lang, region] = tag.split('-');
  return region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase();
};

// Map locale to short region tag displayed at right
const toLangCode = (lang: string) => {
  const lower = lang.toLowerCase();
  if (lower.startsWith('zh-hk')) return 'HK';
  if (lower.startsWith('zh-cn') || lower.startsWith('zh-hans')) return 'CN';// for HK only
  if (lower.startsWith('zh-sg')) return 'SG';
  const base = (lower.split('-')[0] || lower).slice(0, 2);
  return base.toUpperCase();
};

// Match the currentLang transition duration in CSS
const FREEZE_MS = 400;

const LanguageModal: React.FC<LanguageProps> = ({ open, onClose, onChange, onSelected }) => {
  const current = useLocale();
  const t: (k: string) => string = useTranslateUI();
  
  const fullLangItems = useMemo(() => 
    [...FULL_LANGS].map(l => ({ key: l, label: LANG_LABEL_KEYS[l] || l })), 
  []);
  
  const uiOnlyItems = useMemo(() => 
    [...UI_ONLY_LANGS].map(l => ({ key: l, label: LANG_LABEL_KEYS[l] || l })), 
  []);
  
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

  const renderLanguageItem = (it: { key: string; label: string }) => (
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
  );

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
        {/* Full Language Support Section */}
        <div className={styles.langSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>{t('language.fullSupport')}</span>
            <span className={styles.sectionHint}>{t('language.fullSupportHint')}</span>
          </div>
          <div className={styles.sectionItems}>
            {fullLangItems.map(renderLanguageItem)}
          </div>
        </div>

        {/* UI-Only Language Support Section */}
        <div className={styles.langSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>{t('language.uiOnly')}</span>
            <span className={styles.sectionHint}>{t('language.uiOnlyHint')}</span>
          </div>
          <div className={styles.sectionItems}>
            {uiOnlyItems.map(renderLanguageItem)}
          </div>
          <span className={styles.sectionHint}>{t('language.fyi')}</span>
        </div>
      </div>
    </Modal>
  );
};

export default React.memo(LanguageModal);

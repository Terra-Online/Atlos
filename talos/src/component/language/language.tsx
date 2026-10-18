import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Modal from '@/component/modal/modal';
import I18nIcon from '@/assets/logos/i18n.svg?react';
import styles from './language.module.scss';
import {
  FULL_LANGS,
  LANG_NATIVE_LABELS,
  UI_ONLY_LANGS,
  getLangDisplayCode,
  getCurrentLocale,
  getFontRegionForLocale,
  preloadLocale,
  setLocale,
  toBCP47,
  useLocale,
  type Lang,
} from '@/locale';
import { useTranslateUI } from '@/locale';
import { preloadFontManifests, preloadFontRegion } from '@/locale/fontLoader';
import parse from 'html-react-parser';

export interface LanguageProps {
  open: boolean;
  onClose: () => void;
  onChange?: (open: boolean) => void;
  onSelected?: (lang: string) => void;
  prepareLocale?: (lang: string) => Promise<unknown>;
  commitLocale?: (lang: string, data: unknown) => void;
  preloadFonts?: (lang: string) => void;
}

// Match the currentLang transition duration in CSS
const FREEZE_MS = 400;
type LanguageItem = { key: Lang; label: string };

const LanguageModal: React.FC<LanguageProps> = ({ open, onClose, onChange, onSelected, prepareLocale, commitLocale, preloadFonts }) => {
  const current = useLocale();
  const t: (k: string) => string = useTranslateUI();
  
  const fullLangItems = useMemo(() => 
    [...FULL_LANGS].map(l => ({ key: l, label: LANG_NATIVE_LABELS[l] || l })),
  []);
  
  const uiOnlyItems = useMemo(() => 
    [...UI_ONLY_LANGS].map(l => ({ key: l, label: LANG_NATIVE_LABELS[l] || l })),
  []);
  
  const groupId = useId();
  const preloadedRegions = useRef(new Set<Exclude<ReturnType<typeof getFontRegionForLocale>, null>>());
  const preloadedLocales = useRef(new Set<string>());

  const warmLanguage = useCallback((lang: string) => {
    const region = getFontRegionForLocale(lang);
    if (preloadFonts) {
      preloadFonts(lang);
    } else if (region && !preloadedRegions.current.has(region)) {
      preloadedRegions.current.add(region);
      preloadFontRegion(region);
    }
    if (!preloadedLocales.current.has(lang)) {
      preloadedLocales.current.add(lang);
      preloadLocale(lang);
      void prepareLocale?.(lang);
    }
  }, []);

  useEffect(() => {
    if (open) preloadFontManifests();
    // These native labels keep their own glyphs across document languages.
    // Warm the existing CSS face while the closed dialog is already mounted.
    void document.fonts?.load("700 1rem 'Lang Origin'", '简体中文繁體中文日本語').catch(() => undefined);
  }, [open]);

  // freeze last active current lang, avoiding flicker when switching langs
  const [freeze, setFreeze] = useState<{ from: string; currentText: string } | null>(null);
  const freezeTimerRef = useRef<number | null>(null);

  const pickRevision = useRef(0);
  const pendingPick = useRef<string | null>(null);
  const handlePick = useCallback(async (lang: string) => {
    if (!lang || (lang === current && pendingPick.current === null)) return;
    const revision = ++pickRevision.current;
    pendingPick.current = lang;
    // A direct click does not fire the row hover handler. Start the same
    // area-aware preparation immediately so setLocale can reuse its pending
    // FontFace batch instead of discovering it after the locale request.
    const targetRegion = getFontRegionForLocale(lang);
    if (targetRegion) preloadFontRegion(targetRegion);
    // record last-actived
    const prevKey = current;
  const prevCurrentText = t('language.current');
    setFreeze({ from: prevKey, currentText: prevCurrentText });
    if (freezeTimerRef.current) {
      window.clearTimeout(freezeTimerRef.current);
      freezeTimerRef.current = null;
    }
    try {
      // Start the standalone catalog and shared font transaction together.
      // Waiting for the catalog first leaves the font manifest behind several
      // locale chunks on a cold cache, which makes a language switch appear
      // much slower than the old loader.
      const catalog = prepareLocale?.(lang);
      const fonts = setLocale(
        lang,
        () => revision === pickRevision.current,
        commitLocale && catalog
          ? async () => {
              const data = await catalog;
              return () => commitLocale(lang, data);
            }
          : undefined,
      );
      await Promise.all([catalog, fonts]);
      if (revision !== pickRevision.current) return;
    } catch (error: unknown) {
      if (revision === pickRevision.current) {
        pendingPick.current = null;
        setFreeze(null);
      }
      console.warn('Language preparation failed:', error);
      return;
    }
    if (revision !== pickRevision.current) return;
    pendingPick.current = null;
    if (getCurrentLocale() !== lang) {
      setFreeze(null);
      return;
    }
    onSelected?.(lang);
    freezeTimerRef.current = window.setTimeout(() => {
      setFreeze(null);
      freezeTimerRef.current = null;
    }, FREEZE_MS);
  }, [current, t, onSelected, prepareLocale, commitLocale]);
  useEffect(() => () => {
    if (freezeTimerRef.current) window.clearTimeout(freezeTimerRef.current);
  }, []);

  const renderLanguageItem = (it: LanguageItem) => (
    <button
      key={it.key}
      type="button"
      className={`${styles.langItem} ${current === it.key ? styles.active : ''}`}
      onClick={() => { void handlePick(it.key); }}
      role="radio"
      aria-checked={current === it.key}
      aria-label={t(`language.names.${it.key}`) || (LANG_NATIVE_LABELS[it.key] || it.key)}
      onPointerDown={() => warmLanguage(it.key)}
      onPointerEnter={() => warmLanguage(it.key)}
      onMouseEnter={() => warmLanguage(it.key)}
      onFocus={() => warmLanguage(it.key)}
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
        {getLangDisplayCode(it.key)}
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
      // The modal inherits the shell's bold face. Registering a separate
      // Bold run here starts a large current-locale shard while the user is
      // opening the picker, which can compete with the next locale switch.
      fontRuns={[{ faces: ['m'], text: '' }]}
      icon={<I18nIcon aria-hidden="true" />}
      customHeight='65dvh'
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
          <span className={styles.sectionHint}>{parse(t('language.fyi'))}</span>
        </div>
      </div>
    </Modal>
  );
};

export default React.memo(LanguageModal);

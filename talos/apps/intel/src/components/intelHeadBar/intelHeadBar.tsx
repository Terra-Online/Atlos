import { useTheme } from '@main/platform/useTheme';
import { useEffect, useState } from 'react';
import LanguageModal from '@main/component/language/language';
import { HeadBar, HeadItem } from '@main/component/headBar/headBar';
import { useTranslateUI } from '@main/locale';
import { getFontRegionForLocale } from '@main/locale';
import { preloadFontRegion } from '@main/locale/fontLoader';
import { applyLocaleData as applyIntelLocaleData, preloadLocale, type I18nBundle } from '@intel/locale';
import { cleanupTheme, initTheme, toggleTheme } from '@main/platform/theme';
import Darkmode from '@main/assets/logos/darkmode.svg?react';
import I18n from '@main/assets/logos/i18n.svg?react';
import styles from './intelHeadBar.module.scss';

const IntelHeadBar = () => {
  const tUI = useTranslateUI();
  const isDark = useTheme() === 'dark';
  const [languageOpen, setLanguageOpen] = useState(false);

  useEffect(() => {
    initTheme();
    return () => cleanupTheme();
  }, []);

  return (
    <>
      <div className={styles.host}>
        <HeadBar>
          <HeadItem
            icon={Darkmode}
            onClick={toggleTheme}
            tooltip={isDark ? tUI('headbar.lightmode') : tUI('headbar.darkmode')}
            guideKey="dark-mode"
          />
          <HeadItem
            icon={I18n}
            onClick={() => setLanguageOpen(true)}
            tooltip={tUI('headbar.language')}
            guideKey="language"
          />
        </HeadBar>
      </div>

      <LanguageModal
        open={languageOpen}
        onClose={() => setLanguageOpen(false)}
        onChange={setLanguageOpen}
        prepareLocale={preloadLocale}
        commitLocale={(locale, data) => {
          applyIntelLocaleData(locale, data as I18nBundle);
        }}
        preloadFonts={(locale) => {
          const region = getFontRegionForLocale(locale);
          if (region) preloadFontRegion(region);
        }}
      />
    </>
  );
};

export default IntelHeadBar;

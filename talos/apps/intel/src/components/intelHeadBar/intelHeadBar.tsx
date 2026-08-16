import { useEffect, useState } from 'react';
import LanguageModal from '@main/component/language/language';
import { HeadBar, HeadItem } from '@main/component/headBar/headBar';
import { useTranslateUI } from '@main/locale';
import { setLocale as setIntelLocale } from '@intel/locale';
import { cleanupTheme, initTheme, toggleTheme } from '@main/utils/theme';
import Darkmode from '@main/assets/logos/darkmode.svg?react';
import I18n from '@main/assets/logos/i18n.svg?react';
import styles from './intelHeadBar.module.scss';

const IntelHeadBar = () => {
  const tUI = useTranslateUI();
  const [isDark, setIsDark] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);

  useEffect(() => {
    initTheme();
    setIsDark(document.documentElement.getAttribute('data-theme') === 'dark');
    return () => cleanupTheme();
  }, []);

  const handleTheme = () => {
    toggleTheme();
    setIsDark((current) => !current);
  };

  return (
    <>
      <div className={styles.host}>
        <HeadBar>
          <HeadItem
            icon={Darkmode}
            onClick={handleTheme}
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
        onSelected={(locale) => {
          void setIntelLocale(locale);
        }}
      />
    </>
  );
};

export default IntelHeadBar;

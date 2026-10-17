import { useTheme } from '@main/platform/useTheme';
import { HeadBar, HeadItem } from '@main/component/headBar/headBar';
import { lazy, Suspense, useEffect, useState } from 'react';
import { cleanupTheme, initTheme, toggleTheme } from '@main/platform/theme';
import { useTranslateUI as useTranslateMainUI } from '@main/locale';
import { getFontRegionForLocale } from '@main/locale';
import { preloadFontRegion } from '@main/locale/fontLoader';
import { useTranslateUI, setLocaleData, preloadLocale } from '@hub/locale';
import Darkmode from '@main/assets/logos/darkmode.svg?react';
import I18n from '@main/assets/logos/i18n.svg?react';
import Refresh from '@main/assets/images/UI/refresh.svg?react';
import styles from './header.module.scss';

const Language = lazy(() => import('@main/component/language/language'));

type Props = {
    busy: boolean;
    onRefresh: () => void;
};

export default function Header({ busy, onRefresh }: Props) {
    const t = useTranslateUI();
    const main = useTranslateMainUI();
    const isDark = useTheme() === 'dark';
    const [languageOpen, setLanguageOpen] = useState(false);

    useEffect(() => {
        initTheme();
        return cleanupTheme;
    }, []);

    const themeLabel = main(isDark ? 'headbar.lightmode' : 'headbar.darkmode');

    return (
        <>
            <header className={styles.header}>
                <div className={styles.host}>
                    <HeadBar>
                        <HeadItem
                            icon={Darkmode}
                            tooltip={themeLabel}
                            guideKey='dark-mode'
                            onClick={toggleTheme}
                        />
                        <HeadItem
                            icon={I18n}
                            tooltip={main('headbar.language')}
                            onClick={() => setLanguageOpen(true)}
                        />
                        <HeadItem
                            icon={Refresh}
                            tooltip={t('userHub.refresh')}
                            guideKey='refresh'
                            onClick={onRefresh}
                            disabled={busy}
                        />
                    </HeadBar>
                </div>
            </header>
            {languageOpen && (
                <Suspense fallback={null}>
                    <Language
                        open
                        onClose={() => setLanguageOpen(false)}
                        onChange={setLanguageOpen}
                        prepareLocale={preloadLocale}
                        preloadFonts={(locale) => {
                            const region = getFontRegionForLocale(locale);
                            if (region) preloadFontRegion(region);
                        }}
                        onSelected={(locale) => {
                            void setLocaleData(locale);
                        }}
                    />
                </Suspense>
            )}
        </>
    );
}

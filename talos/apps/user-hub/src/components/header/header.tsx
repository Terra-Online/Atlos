import { HeadBar, HeadItem } from '@main/component/headbar/headbar';
import { lazy, Suspense, useEffect, useState } from 'react';
import { cleanupTheme, initTheme, toggleTheme } from '@main/platform/theme';
import { useTranslateUI as useTranslateMainUI } from '@main/locale';
import { useTranslateUI, setLocale } from '@hub/locale';
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
    const [isDark, setIsDark] = useState(false);
    const [languageOpen, setLanguageOpen] = useState(false);

    useEffect(() => {
        initTheme();
        const root = document.documentElement;
        const readTheme = () => setIsDark(root.dataset.theme === 'dark');
        readTheme();
        const observer = new MutationObserver(readTheme);
        observer.observe(root, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });
        return () => {
            observer.disconnect();
            cleanupTheme();
        };
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
                        onSelected={(locale) => {
                            void setLocale(locale);
                        }}
                    />
                </Suspense>
            )}
        </>
    );
}

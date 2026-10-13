import type { MouseEvent } from 'react';
import { tabs, pathForTab, navigate, type Tab } from '../../routing';
import { useTranslateUI } from '@hub/locale';
import styles from './nav.module.scss';

export default function Nav({ active }: { active: Tab }) {
    const t = useTranslateUI();
    return (
        <nav className={styles.nav} aria-label={t('userHub.navigation')}>
            {tabs.map((tab) => {
                const selected = active === tab;
                const hint =
                    tab === 'contributions'
                        ? t('userHub.contentHint')
                        : tab === 'profile'
                          ? t('userHub.profileHint')
                          : t('userHub.accountHint');
                return (
                    <a
                        key={tab}
                        href={pathForTab(tab)}
                        className={styles.item}
                        aria-current={selected ? 'page' : undefined}
                        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                            if (
                                event.button !== 0 ||
                                event.metaKey ||
                                event.ctrlKey ||
                                event.shiftKey ||
                                event.altKey
                            )
                                return;
                            event.preventDefault();
                            navigate(tab);
                        }}
                    >
                        <span className={styles.label}>
                            {t(`userHub.tabs.${tab}`)}
                        </span>
                        <span className={styles.description}>
                            {hint}
                        </span>
                    </a>
                );
            })}
        </nav>
    );
}

import { AccessButton } from '@main/component/login/access/button';
import Email from '@main/assets/logos/login.svg?react';
import Google from '@main/assets/images/UI/media/google.svg?react';
import Discord from '@main/assets/images/UI/media/discordicon.svg?react';
import Github from '@main/assets/images/UI/media/ghicon.svg?react';
import { providerLabels, formatDate } from '../../config';
import type { LoginMethod, Provider } from '../../types';
import { useTranslateUI } from '@hub/locale';
import styles from './login.module.scss';

const providers: Provider[] = ['email', 'google', 'discord', 'github'];
const icons = {
    email: Email,
    google: Google,
    discord: Discord,
    github: Github,
};

export default function Login({
    methods,
    busy,
    onLink,
    onUnlink,
}: {
    methods: LoginMethod[];
    busy: boolean;
    onLink: (provider: Exclude<Provider, 'email'>) => void;
    onUnlink: (provider: Provider) => void;
}) {
    const t = useTranslateUI();
    return (
        <section className={styles.panel}>
            <h3>{t('userHub.loginMethods')}</h3>
            <div className={styles.rows}>
                {providers.map((provider) => {
                    const Icon = icons[provider];
                    const method = methods.find(
                        (item) => item.provider === provider,
                    );
                    return (
                        <div className={styles.row} key={provider}>
                            <span
                                className={
                                    method
                                        ? styles.icon
                                        : `${styles.icon} ${styles.muted}`
                                }
                            >
                                <Icon aria-hidden='true' />
                            </span>
                            <div>
                                <strong>{providerLabels[provider]}</strong>
                                <small>
                                    {method
                                        ? method.verified
                                            ? t('userHub.verified')
                                            : `${t('userHub.linkedAt')} ${formatDate(method.linkedAt)}`
                                        : t('userHub.notLinked')}
                                </small>
                            </div>
                            {method?.unlinkable && (
                                <AccessButton
                                    onClick={() => onUnlink(provider)}
                                    disabled={busy}
                                    label={t('userHub.unlink')}
                                />
                            )}
                            {!method && provider !== 'email' && (
                                <AccessButton
                                    onClick={() => onLink(provider)}
                                    disabled={busy}
                                    label={t('userHub.link')}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
            <p className={styles.note}>{t('userHub.keepLoginMethod')}</p>
        </section>
    );
}

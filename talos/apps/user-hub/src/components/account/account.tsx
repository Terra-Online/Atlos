import { useTranslateUI } from '@hub/locale';
import Login from './login';
import Endfield from './endfield';
import { formatDate } from '../../config';
import type { Overview, Provider } from '../../types';
import styles from './account.module.scss';

type Props = {
    overview: Overview;
    busy: boolean;
    onLink: (provider: Exclude<Provider, 'email'>) => void;
    onUnlink: (provider: Provider) => void;
    onUnlinkEndfield: () => void;
};

export default function Account({
    overview,
    busy,
    onLink,
    onUnlink,
    onUnlinkEndfield,
}: Props) {
    const t = useTranslateUI();
    return (
        <div className={styles.page}>
            <header className={styles.heading}>
                <h2>{t('userHub.tabs.account')}</h2>
                <p>{t('userHub.accountHint')}</p>
            </header>
            <div className={styles.groups}>
                <section
                    className={styles.details}
                    aria-label={t('userHub.accountStatus')}
                >
                    <dl>
                        <div>
                            <dt>{t('userHub.email')}</dt>
                            <dd>{overview.user.email || '—'}</dd>
                        </div>
                        <div>
                            <dt>{t('userHub.registeredAt')}</dt>
                            <dd>{formatDate(overview.user.registeredAt)}</dd>
                        </div>
                    </dl>
                </section>
                <Login
                    methods={overview.loginMethods}
                    busy={busy}
                    onLink={onLink}
                    onUnlink={onUnlink}
                />
                <Endfield
                    binding={overview.services.endfield}
                    busy={busy}
                    onUnlink={onUnlinkEndfield}
                />
            </div>
        </div>
    );
}

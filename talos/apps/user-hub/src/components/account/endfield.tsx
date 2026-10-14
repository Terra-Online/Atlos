import { AccessButton } from '@main/component/login/access/button';
import { useTranslateUI } from '@hub/locale';
import type { EndfieldBinding } from '../../types';
import styles from './endfield.module.scss';

type Props = {
    binding: EndfieldBinding;
    busy: boolean;
    onUnlink: () => void;
};

export default function Endfield({ binding, busy, onUnlink }: Props) {
    const t = useTranslateUI();
    return (
        <section className={styles.section}>
            <h3>{t('userHub.endfieldAccount')}</h3>
            {binding.bound ? (
                <div className={styles.binding}>
                    <div>
                        <strong>
                            {binding.nickname || t('userHub.endfieldRole')}
                        </strong>
                        <small>
                            {binding.serverName ||
                                `${t('userHub.server')} ${binding.serverId ?? '-'}`}{' '}
                            · {binding.provider ?? '-'}
                        </small>
                    </div>
                    <span
                        className={
                            binding.enabled ? styles.enabled : styles.disabled
                        }
                    >
                        {t(
                            binding.enabled
                                ? 'userHub.enabled'
                                : 'userHub.disabled',
                        )}
                    </span>
                    <AccessButton
                        onClick={onUnlink}
                        disabled={busy}
                        label={t('userHub.unlink')}
                    />
                </div>
            ) : (
                <p className={styles.empty}>{t('userHub.notBound')}</p>
            )}
            <p className={styles.note}>
                {t('userHub.bindFromMap')}{' '}
                <a href='/'>{t('userHub.back')}</a>
            </p>
        </section>
    );
}

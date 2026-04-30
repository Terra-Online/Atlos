import React, { useCallback, useState } from 'react';
import classNames from 'classnames';
import Modal from '@/component/modal/modal';
import { AccessButton } from '@/component/login/access';
import profileStyles from '@/component/login/profile/profile.module.scss';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useTranslateUI } from '@/locale';
import { agreePolicy } from '@/utils/endfield/backendClient';
import { readEFTrackerConf, saveEFTrackerConf } from '@/utils/endfield/config';
import SklandIcon from '@/assets/images/UI/media/sklandicon.svg?react';
import SkportIcon from '@/assets/images/UI/media/skporticon.svg?react';
import { currentMode, disableSession } from './session';
import { useLocatorStore } from './state';
import styles from './Locator.module.scss';

const LocationAuth: React.FC = () => {
    const t = useTranslateUI();
    const open = useLocatorStore((state) => state.authOpen);
    const closeAuth = useLocatorStore((state) => state.closeAuth);
    const clearBanner = useLocatorStore((state) => state.clearBanner);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const errorText = error ?? '';
    const shouldShowError = open && Boolean(errorText);
    const isErrorRemoved = !shouldShowError;
    const mode = currentMode();
    const Icon = mode === 'skland' ? SklandIcon : SkportIcon;

    const close = useCallback(() => {
        if (loading) return;
        setError('');
        disableSession();
        useLocatorStore.getState().setLastPosition(null);
        closeAuth();
    }, [closeAuth, loading]);

    const authorize = useCallback(async () => {
        if (loading) return;
        const current = readEFTrackerConf();
        setError('');
        setLoading(true);

        try {
            await agreePolicy(current
                ? {
                    roleId: current.roleId,
                    serverId: current.serverId,
                }
                : undefined);

            if (current) {
                saveEFTrackerConf({
                    ...current,
                    enabled: true,
                    locatorSync: true,
                });
                useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(true);
                useLocatorStore.getState().setViewMode('tracking');
            }

            clearBanner();
            closeAuth();
        } catch (err) {
            setError(err instanceof Error ? err.message : (t('locator.errors.authorizationFailed') || 'Authorization failed.'));
        } finally {
            setLoading(false);
        }
    }, [clearBanner, closeAuth, loading, t]);

    return (
        <Modal
            open={open}
            size="s"
            onClose={close}
            title={t('locator.binding.locateAuth') || 'Location Sync Authorization'}
            icon={<Icon />}
            iconScale={0.86}
        >
            <div className={styles.authPane}>
                <div className={styles.authBody}>
                    {t('locator.binding.locateAuthBody') || 'Enabling Location Sync will allow access to your in-game location information. Do you want to enable it'}
                </div>
                <div
                    className={styles.bindingError}
                    data-removed={isErrorRemoved ? 'true' : 'false'}
                    data-text={errorText}
                    aria-live="polite"
                >
                    {errorText}
                </div>
                <div className={classNames(profileStyles.profileActions, styles.singleAction)}>
                    <AccessButton
                        onClick={() => {
                            void authorize();
                        }}
                        disabled={loading}
                        label={loading
                            ? (t('common.loading') || 'Loading...')
                            : (t('locator.binding.authAndSync') || 'Authorize and start sync')}
                    />
                </div>
            </div>
        </Modal>
    );
};

export default React.memo(LocationAuth);
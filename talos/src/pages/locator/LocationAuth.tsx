import { EntryButton } from '@/component/button/EntryButton';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import Modal from '@/component/modal/modal';
import profileStyles from '@/component/shared/account/profile/profile.module.scss';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useTranslateUI } from '@/locale';
import { agreePolicy } from '@/services/endfield';
import { readEFTrackerConf, saveEFTrackerConf } from '@/services/endfield';
import SklandIcon from '@/assets/images/UI/media/sklandicon.svg?react';
import SkportIcon from '@/assets/images/UI/media/skporticon.svg?react';
import { currentMode, disableSession } from '@/pages/locator/session';
import { useLocatorStore } from '@/store/locator';
import styles from '@/pages/locator/Locator.module.scss';
import { useRequestOwner } from './useRequestOwner';

const LocationAuth: React.FC = () => {
    const t = useTranslateUI();
    const open = useLocatorStore((state) => state.authOpen);
    const closeAuth = useLocatorStore((state) => state.closeAuth);
    const clearBanner = useLocatorStore((state) => state.clearBanner);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const captureOwner = useRequestOwner();
    const episode = useRef(0);
    useEffect(() => { setLoading(false); setError(''); }, [captureOwner]);
    useEffect(() => useLocatorStore.subscribe((state, previous) => {
        if (state.authOpen === previous.authOpen) return;
        episode.current += 1;
        setLoading(false);
        setError('');
    }), []);
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
        const ownerCurrent = captureOwner();
        const request = episode.current;
        const isCurrent = () => ownerCurrent() && episode.current === request && useLocatorStore.getState().authOpen;
        if (!isCurrent()) return;
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
            if (!isCurrent()) return;

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
            if (!isCurrent()) return;
            setError(err instanceof Error ? err.message : (t('locator.errors.authorizationFailed')));
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [captureOwner, clearBanner, closeAuth, loading, t]);

    return (
        <Modal
            open={open}
            size="s"
            onClose={close}
            title={t('locator.binding.locateAuth')}
            icon={<Icon />}
            iconScale={0.86}
        >
            <div className={styles.authPane}>
                <div className={styles.authBody}>
                    {t('locator.binding.locateAuthBody')}
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
                    <EntryButton
                        onClick={() => {
                            void authorize();
                        }}
                        disabled={loading}
                        label={loading
                            ? t('common.loading')
                            : t('locator.binding.authAndSync')}
                    />
                </div>
            </div>
        </Modal>
    );
};

export default React.memo(LocationAuth);

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import parse from 'html-react-parser';
import Modal from '@/component/modal/modal';
import { AccessButton } from '@/component/login/access';
import profileStyles from '@/component/login/profile/profile.module.scss';
import { Trigger } from '@/component/trigger/trigger';
import { useAuthStore } from '@/store/auth';
import { useLocale, useTranslateUI } from '@/locale';
import {
    getEFBindingStatus,
    unlinkEFBinding,
    type EFBindingSummary,
} from '@/utils/endfield/backendClient';
import {
    readEFTrackerConf,
    saveEFTrackerConf,
    type EFTrackerConf,
    type EFTrackerScope,
} from '@/utils/endfield/config';
import { getCachedBinding, setCachedBinding } from '@/utils/backendCache';
import ConfigIcon from '@/assets/images/UI/config.svg?react';
import { LOCATOR_REMINDER_SCOPE_OPTIONS } from './proximityReminderConfig';
import { docsUrl, disableSession } from './session';
import styles from './Locator.module.scss';

const SCOPES: EFTrackerScope[] = LOCATOR_REMINDER_SCOPE_OPTIONS;

interface LocationConfigProps {
    open: boolean;
    onClose: () => void;
    onChangeBinding: () => void;
    onBindingRemoved?: () => void;
}

const tagFor = (serverName?: string): string => {
    const name = serverName?.toLowerCase() ?? '';
    if (name.includes('europe')) return 'EU/AMER';
    if (name.includes('china')) return 'CN';
    return 'APAC';
};

const readScope = (): EFTrackerScope[] => {
    const scope = readEFTrackerConf()?.scope;
    return scope && scope.length ? scope : ['balanced'];
};

const saveScope = (scope: EFTrackerScope[], binding: EFBindingSummary | null): void => {
    const current = readEFTrackerConf();
    if (current) {
        saveEFTrackerConf({
            ...current,
            scope,
        });
        return;
    }

    if (!binding?.roleId || binding.serverId === undefined) return;

    const next: EFTrackerConf = {
        enabled: false,
        locatorSync: false,
        baseUrl: binding.provider ?? 'skport',
        roleId: binding.roleId,
        serverId: binding.serverId,
        scope,
        trackPoints: true,
        trail: false,
        debug: false,
    };
    saveEFTrackerConf(next);
};

const readTrackPoints = (): boolean =>
    readEFTrackerConf()?.trackPoints ?? true;

const saveTrackPoints = (trackPoints: boolean, binding: EFBindingSummary | null): void => {
    const current = readEFTrackerConf();
    if (current) {
        saveEFTrackerConf({
            ...current,
            trackPoints,
        });
        return;
    }

    if (!binding?.roleId || binding.serverId === undefined) return;

    const next: EFTrackerConf = {
        enabled: false,
        locatorSync: false,
        baseUrl: binding.provider ?? 'skport',
        roleId: binding.roleId,
        serverId: binding.serverId,
        scope: ['balanced'],
        trackPoints,
        trail: false,
        debug: false,
    };
    saveEFTrackerConf(next);
};

const LocationConfig: React.FC<LocationConfigProps> = ({
    open,
    onClose,
    onChangeBinding,
    onBindingRemoved,
}) => {
    const t = useTranslateUI();
    const locale = useLocale();
    const sessionUser = useAuthStore((state) => state.sessionUser);
    const uid = sessionUser?.uid;
    const cachedBinding = useMemo(() => getCachedBinding(uid), [uid]);
    const [binding, setBinding] = useState<EFBindingSummary | null>(cachedBinding.value);
    const [loading, setLoading] = useState(!cachedBinding.hit);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [scope, setScope] = useState<EFTrackerScope[]>(() => readScope());
    const [trackPoints, setTrackPoints] = useState(() => readTrackPoints());
    const errorText = error ?? '';
    const shouldShowError = open && Boolean(errorText);
    const isErrorRemoved = !shouldShowError;

    const refresh = useCallback(() => {
        if (!open) return;
        if (cachedBinding.hit) {
            setBinding(cachedBinding.value);
        }
        setLoading(!cachedBinding.hit);
        setScope(readScope());
        setTrackPoints(readTrackPoints());
        void getEFBindingStatus()
            .then((status) => {
                if (sessionUser?.uid) {
                    setCachedBinding(sessionUser.uid, status.binding);
                }
                setBinding(status.binding);
            })
            .catch(() => setBinding(null))
            .finally(() => setLoading(false));
    }, [cachedBinding.hit, cachedBinding.value, open, sessionUser?.uid]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const toggleScope = useCallback((item: EFTrackerScope) => {
        setScope((current) => {
            const next = current.includes(item)
                ? current.filter((value) => value !== item)
                : [...current, item];
            saveScope(next, binding);
            return next;
        });
    }, [binding]);

    const toggleTrackPoints = useCallback((active: boolean) => {
        setTrackPoints(active);
        saveTrackPoints(active, binding);
    }, [binding]);

    const handleUnlink = useCallback(async () => {
        if (saving) return;
        setError('');
        setSaving(true);
        try {
            const result = await unlinkEFBinding();
            if (sessionUser?.uid) {
                setCachedBinding(sessionUser.uid, result.binding);
            }
            disableSession();
            onBindingRemoved?.();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : (t('locator.errors.unlinkFailed') || 'Failed to unlink binding.'));
        } finally {
            setSaving(false);
        }
    }, [onBindingRemoved, onClose, saving, sessionUser?.uid, t]);

    const tag = tagFor(binding?.serverName);
    const server = binding?.serverName
        || (binding?.serverId !== undefined ? `${t('locator.binding.serverFallback') || 'Server'} ${binding.serverId}` : '-');
    const name = binding?.nickname || binding?.roleId || '-';
    const roleId = binding?.roleId || '-';
    const dataUrl = docsUrl(locale, 'data-collection');

    return (
        <Modal
            open={open}
            size="m"
            onClose={onClose}
            title={t('locator.config.title') || 'Tracking Config'}
            icon={<ConfigIcon />}
            iconScale={0.8}
        >
            <div className={styles.configPane}>
                <div className={styles.roleCard}>
                    {loading ? (
                        <div className={styles.roleName}>{t('common.loading')}</div>
                    ) : (
                        <>
                            <div className={styles.roleBar}></div>
                            <div className={styles.roleInfo}>
                                <div className={styles.roleName}>{name}</div>
                                <div className={styles.roleMeta}>
                                    <span>{t('locator.config.server')}: <span className={styles.roleServer}>{server}</span></span>
                                    <span aria-hidden="true">|</span>
                                    <span>{t('locator.config.uid')}: <span className={styles.roleUid}>{roleId}</span></span>
                                </div>
                            </div>
                            <div className={styles.roleTag}>{tag}</div>
                        </>
                    )}
                </div>

                <div className={classNames(profileStyles.profileActions, styles.configActions)}>
                    <AccessButton
                        onClick={onChangeBinding}
                        disabled={saving}
                        label={t('locator.binding.changeBinding')}
                    />
                    <AccessButton
                        onClick={() => {
                            void handleUnlink();
                        }}
                        disabled={saving}
                        label={saving ? (t('common.loading')) : (t('locator.binding.unlink'))}
                    />
                </div>

                <div className={classNames(profileStyles.profileDivider, styles.configDivider)} data-label={t('locator.config.scopeTitle')}></div>
                <div className={styles.configHint}>
                    {t('locator.config.scopeHint')}
                </div>
                <div className={styles.scopeList}>
                    {SCOPES.map((item) => (
                        <button
                            key={item}
                            type="button"
                            className={classNames(styles.scopeItem, scope.includes(item) && styles.active)}
                            onClick={() => toggleScope(item)}
                            aria-pressed={scope.includes(item)}
                            disabled={!trackPoints}
                        >
                            <div className={styles.scopeMain}>{t(`locator.config.scope.${item}.title`)}</div>
                            <div className={styles.scopeDesc}>{parse(t(`locator.config.scope.${item}.desc`))}</div>
                        </button>
                    ))}
                </div>

                <div className={profileStyles.profileDivider} data-label={t('locator.config.featureTitle') || 'Feature'}></div>
                <div className={styles.featureGrid}>
                    <Trigger
                        isActive={trackPoints}
                        onToggle={toggleTrackPoints}
                        label={t('locator.config.trackPoints')}
                        className={styles.featureTrigger}
                    />
                    <Trigger
                        isActive={false}
                        label={t('locator.config.heatmap')}
                        disabled
                        className={styles.featureTrigger}
                    />
                </div>
                <div className={styles.featureNote}>
                    {t('locator.config.configNote1')}
                    <a href={dataUrl} target="_blank" rel="noopener noreferrer">
                        {t('locator.binding.dataCollection')}
                    </a>
                    {t('locator.config.configNote2')}
                </div>

                <div
                    className={styles.bindingError}
                    data-removed={isErrorRemoved ? 'true' : 'false'}
                    data-text={errorText}
                    aria-live="polite"
                >
                    {errorText}
                </div>
            </div>
        </Modal>
    );
};

export default React.memo(LocationConfig);

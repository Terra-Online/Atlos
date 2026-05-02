import React, { useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import parse from 'html-react-parser';
import Modal from '@/component/modal/modal';
import { AccessButton } from '@/component/login/access';
import { TabView, type TabViewItem } from '@/component/tabView';
import { useAuthStore } from '@/store/auth';
import { useLocale, useTranslateUI } from '@/locale';
import {
    bindEFRole,
    exchangeEFToken,
    type EFBindingSummary,
    type EFRoleOption,
} from '@/utils/endfield/backendClient';
import { readEFTrackerConf } from '@/utils/endfield/config';
import { setCachedBinding } from '@/utils/backendCache';
import profileStyles from '@/component/login/profile/profile.module.scss';
import BindingIcon from '@/assets/logos/binding.svg?react';
import {
    inferLocatorAccountModeFromBaseUrl,
    type LocatorAccountMode,
} from './endfieldHosts';
import {
    applyRole,
    cleanToken,
    docsUrl,
    extractToken,
} from './session';
import styles from './Locator.module.scss';

const BIND_COUNTDOWN_SECONDS = 5;

interface LocationBindingProps {
    open: boolean;
    onClose: () => void;
    onBound?: (binding: EFBindingSummary) => void;
}

const LocationBinding: React.FC<LocationBindingProps> = ({ open, onClose, onBound }) => {
    const t = useTranslateUI();
    const locale = useLocale();
    const existingTrackerConfig = useMemo(() => readEFTrackerConf(), []);
    const [accountMode, setAccountMode] = useState<LocatorAccountMode>(
        inferLocatorAccountModeFromBaseUrl(existingTrackerConfig?.baseUrl),
    );
    const [step, setStep] = useState<'auth' | 'role'>('auth');
    const [roleOptions, setRoleOptions] = useState<EFRoleOption[]>([]);
    const [selectedRoleKey, setSelectedRoleKey] = useState('');
    const [flowId, setFlowId] = useState('');
    const [tokenInput, setTokenInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [countdown, setCountdown] = useState(BIND_COUNTDOWN_SECONDS);
    const sessionUser = useAuthStore((state) => state.sessionUser);
    const l = useCallback((key: string, fallback: string) => t(key) || fallback, [t]);
    const errorText = error ?? '';
    const shouldShowError = open && Boolean(errorText);
    const isErrorRemoved = !shouldShowError;

    const reset = useCallback(() => {
        setError('');
        setStep('auth');
        setRoleOptions([]);
        setSelectedRoleKey('');
        setFlowId('');
        setTokenInput('');
        setLoading(false);
        setCountdown(BIND_COUNTDOWN_SECONDS);
    }, []);

    const close = useCallback(() => {
        reset();
        onClose();
    }, [onClose, reset]);

    useEffect(() => {
        if (!open) return undefined;
        setCountdown(BIND_COUNTDOWN_SECONDS);
        const timer = window.setInterval(() => {
            setCountdown((value) => Math.max(0, value - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [open]);

    const finishBind = useCallback((mode: LocatorAccountMode, role: EFRoleOption, binding: EFBindingSummary) => {
        if (sessionUser?.uid) {
            setCachedBinding(sessionUser.uid, binding);
        }
        applyRole(mode, role);
        onBound?.(binding);
        close();
    }, [close, onBound, sessionUser?.uid]);

    const loadRoles = useCallback(async (
        nextFlowId: string,
        roles: EFRoleOption[],
        mode: LocatorAccountMode,
    ) => {
        if (!roles.length) {
            throw new Error(l('locator.errors.noRole', 'No Endfield roles found on this account.'));
        }

        if (roles.length === 1) {
            const result = await bindEFRole(nextFlowId, roles[0]);
            finishBind(mode, roles[0], result.binding);
            return;
        }

        const defaultRole = roles.find((role) => role.isDefault) ?? roles[0];
        setRoleOptions(roles);
        setSelectedRoleKey(`${defaultRole.serverId}:${defaultRole.roleId}`);
        setFlowId(nextFlowId);
        setAccountMode(mode);
        setStep('role');
    }, [finishBind, l]);

    const bindByToken = useCallback(async () => {
        const accountToken = extractToken(tokenInput);
        if (!accountToken) {
            setError(l('locator.errors.tokenRequired', 'Paste the full response or the token.'));
            return;
        }

        const exchanged = await exchangeEFToken(accountMode, accountToken);
        await loadRoles(exchanged.flowId, exchanged.roles, accountMode);
    }, [accountMode, l, loadRoles, tokenInput]);

    const confirmRole = useCallback(async () => {
        const role = roleOptions.find((item) => `${item.serverId}:${item.roleId}` === selectedRoleKey);
        if (!role || !flowId) {
            setError(l('locator.errors.roleRequired', 'Please select a role.'));
            return;
        }
        const result = await bindEFRole(flowId, role);
        finishBind(accountMode, role, result.binding);
    }, [accountMode, finishBind, flowId, l, roleOptions, selectedRoleKey]);

    const handleBind = useCallback(async () => {
        if (loading || countdown > 0) return;
        setError('');
        setLoading(true);
        try {
            if (step === 'auth') await bindByToken();
            else await confirmRole();
        } catch (err) {
            setError(err instanceof Error ? err.message : l('locator.errors.bindingFailed', 'Binding failed.'));
        } finally {
            setLoading(false);
        }
    }, [bindByToken, confirmRole, countdown, l, loading, step]);

    const switchMode = useCallback((mode: LocatorAccountMode) => {
        setAccountMode(mode);
        setError('');
        setTokenInput('');
        setStep('auth');
        setRoleOptions([]);
        setSelectedRoleKey('');
        setFlowId('');
    }, []);

    const tabItems: TabViewItem[] = useMemo(() => [
        {
            key: 'skland',
            label: t('locator.binding.chinaTab'),
            description: (
                <ol className={styles.bindStep}>
                    <li>{parse(t('locator.binding.CNStep0'))}</li>
                    <li>{parse(t('locator.binding.CNStep1'))}</li>
                    <li>{t('locator.binding.Step2')}</li>
                </ol>
            ),
        },
        {
            key: 'skport',
            label: t('locator.binding.globalTab'),
            description: (
                <ol className={styles.bindStep}>
                    <li>{parse(t('locator.binding.UniStep0'))}</li>
                    <li>{parse(t('locator.binding.UniStep1'))}</li>
                    <li>{t('locator.binding.Step2')}</li>
                </ol>
            ),
        },
    ], [t]);

    const bindLabelTemplate = t('locator.binding.bindWithCountdown');
    const bindLabel = countdown > 0
        ? bindLabelTemplate.replace('{sec}', String(countdown))
        : t('locator.binding.bind');

    return (
        <Modal
            open={open}
            size="l"
            onClose={close}
            title={t('locator.binding.title')}
            icon={<BindingIcon />}
            iconScale={0.86}
        >
            <div className={styles.bindingForm}>
                <TabView
                    items={tabItems}
                    activeKey={accountMode}
                    onChange={(key) => switchMode(key as LocatorAccountMode)}
                    fill
                />

                {step === 'auth' ? (
                    <div className={styles.bindingFields}>
                        <textarea
                            className={styles.tokenTextarea}
                            value={tokenInput}
                            onChange={(event) => setTokenInput(cleanToken(event.target.value))}
                            placeholder={'{"code":0,"data":{"content":"..."}}'}
                            spellCheck={false}
                        />
                    </div>
                ) : (
                    <div className={styles.roleSelectList}>
                        {roleOptions.map((role) => {
                            const key = `${role.serverId}:${role.roleId}`;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    className={classNames(styles.roleOption, selectedRoleKey === key && styles.roleOptionActive)}
                                    onClick={() => setSelectedRoleKey(key)}
                                >
                                    <div className={styles.roleOptionName}>{role.nickname || role.roleId}</div>
                                    <div className={styles.roleOptionMeta}>
                                        {role.serverName || role.serverType || `${t('locator.binding.serverFallback') || 'Server'} ${role.serverId}`}
                                        {' · '}
                                        {t('locator.binding.levelPrefix') || 'Lv.'}
                                        {role.level}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                <div
                    className={styles.bindingError}
                    data-removed={isErrorRemoved ? 'true' : 'false'}
                    data-text={errorText}
                    aria-live="polite"
                >
                    {errorText}
                </div>

                <div className={styles.bindingFooter}>
                    <div className={styles.policyReminder}>
                        <span>{t('locator.binding.docsLead')}</span>
                        <span>
                            <a href={docsUrl(locale, 'tos')} target="_blank" rel="noopener noreferrer">
                                {t('locator.binding.tos')}
                            </a>
                            {' · '}
                            <a href={docsUrl(locale, 'privacy')} target="_blank" rel="noopener noreferrer">
                                {t('locator.binding.privacy')}
                            </a>
                            {' · '}
                            <a href={docsUrl(locale, 'data-collection')} target="_blank" rel="noopener noreferrer">
                                {t('locator.binding.dataCollection') || 'Data Collection'}
                            </a>
                            {' · '}
                            <a href={docsUrl(locale, 'disclaimer')} target="_blank" rel="noopener noreferrer">
                                {t('locator.binding.disclaimer')}
                            </a>
                        </span>
                    </div>
                    <div className={classNames(styles.singleAction, profileStyles.profileActions)}>
                        <AccessButton
                            onClick={() => {
                                void handleBind();
                            }}
                            disabled={loading || countdown > 0}
                            label={loading
                                ? t('common.loading')
                                : bindLabel}
                        />
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default React.memo(LocationBinding);

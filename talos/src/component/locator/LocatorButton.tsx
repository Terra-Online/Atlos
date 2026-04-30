import React, { useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import Modal from '@/component/modal/modal';
import parse from 'html-react-parser';
import { openOemAuthModal } from '@/component/login/authEvents';
import { AccessButton } from '@/component/login/access';
import { TabView, type TabViewItem } from '@/component/tabView';
import { useAuthStore } from '@/store/auth';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useLocale, useTranslateUI } from '@/locale';
import {
    bindEFRole,
    exchangeEFToken,
    getEFBindingStatus,
    unlinkEFBinding,
    type EFBindingSummary,
    type EFRoleOption,
} from '@/utils/endfield/backendClient';
import {
    readEFTrackerConf,
    saveEFTrackerConf,
    type EFTrackerConf,
} from '@/utils/endfield/config';
import { SubregionSwitch } from '@/component/regSwitch/regSwitch';
import regSwitchStyles from '@/component/regSwitch/regSwitch.module.scss';
import profileStyles from '@/component/login/profile/profile.module.scss';
import styles from './Locator.module.scss';
import LocateCloseIcon from '@/assets/images/UI/locateclose.svg?react';
import LocateOpenIcon from '@/assets/images/UI/locateopen.svg?react';
import LocateCurrentIcon from '@/assets/images/UI/locatecurrent.svg?react';
import BindingIcon from '@/assets/logos/binding.svg?react';
import {
    inferLocatorAccountModeFromBaseUrl,
    type LocatorAccountMode,
} from './endfieldHosts';
import {
    requestLocatorReturnCurrent,
    useLocatorStore,
    type LocatorViewMode,
} from './state';

type LocatorButtonVariant = 'desktop' | 'mobile';
const BIND_COUNTDOWN_SECONDS = 5;

const extractToken = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';

    try {
        const parsed = JSON.parse(trimmed) as {
            data?: {
                content?: unknown;
                accountToken?: unknown;
                token?: unknown;
            };
            content?: unknown;
            accountToken?: unknown;
            token?: unknown;
        };
        const content = parsed.data?.content
            ?? parsed.data?.accountToken
            ?? parsed.data?.token
            ?? parsed.content
            ?? parsed.accountToken
            ?? parsed.token;
        if (typeof content === 'string') return content.trim();
    } catch {
        const matched = trimmed.match(/"(?:content|accountToken|token)"\s*:\s*"([^"]+)"/);
        if (matched?.[1]) return matched[1].trim();
    }

    return trimmed;
};

const sanitizeToken = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return raw;

    try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if ('msg' in parsed) {
            const { msg: _msg, ...rest } = parsed;
            return JSON.stringify(rest);
        }
    } catch {
        return raw.replace(/,?\s*"msg"\s*:\s*"[^"]*"\s*/g, (match) => (match.trimStart().startsWith(',') ? '' : ''));
    }

    return raw;
};

const resolveDocsLang = (locale: string): string => {
    const normalized = locale.trim().toLowerCase();
    if (normalized === 'zh-hk') return '';
    if (normalized.startsWith('zh-cn')) return 'zh-CN';
    if (normalized.startsWith('ja')) return 'ja';
    if (normalized.startsWith('ko')) return 'ko';
    if (normalized.startsWith('en')) return 'en';
    return 'en';
};

const buildDocsUrl = (locale: string, slug: string): string => {
    const lang = resolveDocsLang(locale);
    const path = lang ? `/${encodeURIComponent(lang)}/docs/${slug}` : `/docs/${slug}`;
    return `https://blog.opendfieldmap.org${path}`;
};

const applyRoleConfig = (
    accountMode: LocatorAccountMode,
    role: EFRoleOption,
): void => {
    const currentConfig = readEFTrackerConf();
    const nextConfig: EFTrackerConf = {
        enabled: true,
        locatorSync: true,
        baseUrl: accountMode,
        roleId: role.roleId,
        serverId: role.serverId,
        debug: currentConfig?.debug ?? false,
        intervalMs: currentConfig?.intervalMs,
    };
    saveEFTrackerConf(nextConfig);
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(true);
    useLocatorStore.getState().setViewMode('tracking');
};

const enableExistingLocatorSession = async (): Promise<boolean> => {
    const current = readEFTrackerConf();
    const status = await getEFBindingStatus();
    if (!status.binding.bound || !status.binding.enabled || !status.binding.roleId || status.binding.serverId === undefined) {
        return false;
    }

    saveEFTrackerConf({
        ...(current ?? {}),
        enabled: true,
        locatorSync: true,
        baseUrl: status.binding.provider ?? current?.baseUrl ?? 'skport',
        roleId: status.binding.roleId,
        serverId: status.binding.serverId,
        debug: current?.debug ?? false,
    });
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(true);
    useLocatorStore.getState().setViewMode('tracking');
    return true;
};

const disableLocatorLocal = (): void => {
    disableLocator();
};

const disableLocator = (): void => {
    const current = readEFTrackerConf();
    if (current) {
        saveEFTrackerConf({
            ...current,
            enabled: false,
            locatorSync: false,
        });
    }
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(false);
    useLocatorStore.getState().setViewMode('off');
};

const resolveIcon = (viewMode: LocatorViewMode): React.FC =>
    viewMode === 'tracking'
        ? LocateOpenIcon
        : viewMode === 'detached'
            ? LocateCurrentIcon
            : LocateCloseIcon;

interface LocatorButtonProps {
    variant?: LocatorButtonVariant;
}

const LocatorButton: React.FC<LocatorButtonProps> = ({ variant = 'desktop' }) => {
    const t = useTranslateUI();
    const sessionUser = useAuthStore((state) => state.sessionUser);
    const viewMode = useLocatorStore((state) => state.viewMode);
    const bindReq = useLocatorStore((state) => state.bindReq);
    const [bindingOpen, setBindingOpen] = useState(false);
    const [pendingAfterLogin, setPendingAfterLogin] = useState(false);
    const [bound, setBound] = useState(false);

    const refreshBindingStatus = useCallback(() => {
        if (!sessionUser) {
            setBound(false);
            return;
        }
        void getEFBindingStatus()
            .then((status) => setBound(Boolean(status.binding.bound)))
            .catch(() => setBound(false));
    }, [sessionUser]);

    useEffect(() => {
        refreshBindingStatus();
    }, [refreshBindingStatus]);

    useEffect(() => {
        if (bindReq <= 0) return;
        setBindingOpen(true);
        refreshBindingStatus();
    }, [bindReq, refreshBindingStatus]);

    useEffect(() => {
        if (!pendingAfterLogin || !sessionUser) return;
        setPendingAfterLogin(false);
        void enableExistingLocatorSession().then((enabled) => {
            setBound((current) => enabled || current);
            if (!enabled) {
                setBindingOpen(true);
            }
        }).catch(() => {
            setBindingOpen(true);
        });
    }, [pendingAfterLogin, sessionUser]);

    const handleClick = useCallback(() => {
        if (viewMode === 'detached') {
            requestLocatorReturnCurrent();
            useLocatorStore.getState().setViewMode('tracking');
            return;
        }

        if (viewMode === 'tracking') {
            disableLocator();
            return;
        }

        if (!sessionUser) {
            setPendingAfterLogin(true);
            openOemAuthModal('login');
            return;
        }

        void enableExistingLocatorSession().then((enabled) => {
            setBound((current) => enabled || current);
            if (!enabled) {
                setBindingOpen(true);
            }
        }).catch(() => {
            setBindingOpen(true);
        });
    }, [sessionUser, viewMode]);

    const Icon = resolveIcon(viewMode);

    if (variant === 'mobile') {
        return (
            <>
                <div className={styles.mobileLocatorShell}>
                    <button
                        type="button"
                        className={styles.mobileLocatorButton}
                        data-active={viewMode !== 'off'}
                        onClick={handleClick}
                    >
                        <Icon />
                    </button>
                </div>
                <LocatorBindingModal
                    open={bindingOpen}
                    onClose={() => {
                        setBindingOpen(false);
                        refreshBindingStatus();
                    }}
                    onBindingRemoved={() => {
                        setBound(false);
                        disableLocatorLocal();
                    }}
                />
            </>
        );
    }

    return (
        <>
            <div className={classNames(regSwitchStyles.regswitch, styles.locatorSwitch)}>
                <div
                    className={classNames(
                        regSwitchStyles.regItem,
                        styles.locatorButton,
                        viewMode !== 'off' && regSwitchStyles.selected,
                    )}
                    onClick={handleClick}
                    role="button"
                    tabIndex={0}
                    aria-label={t('locator.title') || 'Locator'}
                    onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        handleClick();
                    }}
                >
                    <div className={regSwitchStyles.icon}>
                        <Icon />
                    </div>
                    {bound && (
                        <SubregionSwitch
                            showIndicator={false}
                            items={[
                                {
                                    key: 'binding',
                                    icon: BindingIcon,
                                    tooltip: t('locator.binding.currentBinding') || 'Current Binding',
                                    ariaLabel: t('locator.binding.currentBinding') || 'Current Binding',
                                    onClick: () => setBindingOpen(true),
                                },
                            ]}
                        />
                    )}
                </div>
            </div>
            <LocatorBindingModal
                open={bindingOpen}
                onClose={() => {
                    setBindingOpen(false);
                    refreshBindingStatus();
                }}
                onBindingRemoved={() => {
                    setBound(false);
                    disableLocatorLocal();
                }}
            />
        </>
    );
};

interface LocatorBindingModalProps {
    open: boolean;
    onClose: () => void;
    onBindingRemoved?: () => void;
}

const LocatorBindingModal: React.FC<LocatorBindingModalProps> = ({ open, onClose, onBindingRemoved }) => {
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
    const [bindingStatus, setBindingStatus] = useState<EFBindingSummary | null>(null);
    const [replaceMode, setReplaceMode] = useState(false);
    const l = useCallback((key: string, fallback: string) => t(key) || fallback, [t]);

    const resetTransient = useCallback(() => {
        setError('');
        setStep('auth');
        setRoleOptions([]);
        setSelectedRoleKey('');
        setFlowId('');
        setTokenInput('');
        setLoading(false);
        setCountdown(BIND_COUNTDOWN_SECONDS);
        setReplaceMode(false);
    }, []);

    const close = useCallback(() => {
        resetTransient();
        onClose();
    }, [onClose, resetTransient]);

    useEffect(() => {
        if (!open) return undefined;
        void getEFBindingStatus()
            .then((status) => setBindingStatus(status.binding))
            .catch(() => setBindingStatus(null));
        setCountdown(BIND_COUNTDOWN_SECONDS);
        const timer = window.setInterval(() => {
            setCountdown((value) => Math.max(0, value - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [open]);

    const handleUnlink = useCallback(async () => {
        if (loading) return;
        setError('');
        setLoading(true);
        try {
            await unlinkEFBinding();
            onBindingRemoved?.();
            close();
        } catch (err) {
            setError(err instanceof Error ? err.message : l('locator.errors.unlinkFailed', 'Failed to unlink binding.'));
        } finally {
            setLoading(false);
        }
    }, [close, l, loading, onBindingRemoved]);

    const loadRoles = useCallback(async (
        nextFlowId: string,
        roles: EFRoleOption[],
        mode: LocatorAccountMode,
    ) => {
        if (!roles.length) {
            throw new Error(l('locator.errors.noRole', 'No Endfield roles found on this account.'));
        }

        if (roles.length === 1) {
            await bindEFRole(nextFlowId, roles[0]);
            applyRoleConfig(mode, roles[0]);
            close();
            return;
        }

        const defaultRole = roles.find((role) => role.isDefault) ?? roles[0];
        setRoleOptions(roles);
        setSelectedRoleKey(`${defaultRole.serverId}:${defaultRole.roleId}`);
        setFlowId(nextFlowId);
        setAccountMode(mode);
        setStep('role');
    }, [close, l]);

    const bindByToken = useCallback(async () => {
        const accountToken = extractToken(tokenInput);
        if (!accountToken) {
            setError(l('locator.errors.tokenRequired', 'Paste the token response JSON or the content value.'));
            return;
        }

        const exchanged = await exchangeEFToken(accountMode, accountToken);
        await loadRoles(exchanged.flowId, exchanged.roles, accountMode);
    }, [accountMode, l, loadRoles, tokenInput]);

    const handleRoleConfirm = useCallback(async () => {
        const role = roleOptions.find((item) => `${item.serverId}:${item.roleId}` === selectedRoleKey);
        if (!role || !flowId) {
            setError(l('locator.errors.roleRequired', 'Please select a role.'));
            return;
        }
        await bindEFRole(flowId, role);
        applyRoleConfig(accountMode, role);
        close();
    }, [accountMode, close, flowId, l, roleOptions, selectedRoleKey]);

    const handleBind = useCallback(async () => {
        if (loading || countdown > 0) return;
        setError('');
        setLoading(true);
        try {
            if (step === 'auth') await bindByToken();
            else await handleRoleConfirm();
        } catch (err) {
            setError(err instanceof Error ? err.message : l('locator.errors.bindingFailed', 'Binding failed.'));
        } finally {
            setLoading(false);
        }
    }, [bindByToken, countdown, handleRoleConfirm, l, loading, step]);

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
                <>
                    <ol className={styles.bindStep}>
                        <li>{parse(t('locator.binding.CNStep0'))}</li>
                        <li>{parse(t('locator.binding.CNStep1'))}</li>
                        <li>{t('locator.binding.Step2')}</li>
                    </ol>
                </>
            ),
        },
        {
            key: 'skport',
            label: t('locator.binding.globalTab'),
            description: (
                <>
                    <ol className={styles.bindStep}>
                        <li>{parse(t('locator.binding.UniStep0'))}</li>
                        <li>{parse(t('locator.binding.UniStep1'))}</li>
                        <li>{t('locator.binding.Step2')}</li>
                    </ol>
                </>
            ),
        },
    ], [t]);
    const bindLabelTemplate = t('locator.binding.bindWithCountdown');
    const bindLabel = countdown > 0
        ? bindLabelTemplate.replace('{sec}', String(countdown))
        : (t('locator.binding.bind'));
    const tosUrl = buildDocsUrl(locale, 'tos');
    const privacyUrl = buildDocsUrl(locale, 'privacy');
    const dataCollectionUrl = buildDocsUrl(locale, 'data-collection');
    const disclaimerUrl = buildDocsUrl(locale, 'disclaimer');

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
                {bindingStatus?.bound && !replaceMode ? (
                    <div className={styles.bindingManagePanel}>
                        <div className={styles.bindingManageTitle}>
                            {t('locator.binding.currentBinding') || 'Current Binding'}
                        </div>
                        <div className={styles.bindingManageMeta}>
                            <span>{bindingStatus.provider === 'skland' ? t('locator.binding.chinaTab') : t('locator.binding.globalTab')}</span>
                            <span>{bindingStatus.nickname || bindingStatus.roleId}</span>
                            <span>{bindingStatus.serverName || `${t('locator.binding.serverFallback') || 'Server'} ${bindingStatus.serverId ?? ''}`}</span>
                        </div>
                        <div className={classNames(profileStyles.profileActions, styles.manageActions)}>
                            <AccessButton
                                onClick={() => setReplaceMode(true)}
                                disabled={loading}
                                label={t('locator.binding.changeBinding') || 'Change Binding'}
                            />
                            <AccessButton
                                onClick={() => {
                                    void handleUnlink();
                                }}
                                disabled={loading}
                                label={loading ? t('common.loading') : (t('locator.binding.unlink') || 'Unlink')}
                            />
                        </div>
                    </div>
                ) : (
                    <>
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
                            onChange={(event) => setTokenInput(sanitizeToken(event.target.value))}
                            placeholder={t('locator.binding.tokenTextareaPlaceholder')}
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
                    </>
                )}

                {error ? <div className={styles.error}>{error}</div> : <div className={styles.error} aria-hidden="true" />}

                <div className={styles.bindingFooter}>
                    <div className={styles.policyReminder}>
                        <span>{t('locator.binding.docsLead')}</span>
                        <span>
                            <a href={tosUrl} target="_blank" rel="noopener noreferrer">
                                {t('locator.binding.tos')}
                            </a>
                            {' · '}
                            <a href={privacyUrl} target="_blank" rel="noopener noreferrer">
                                {t('locator.binding.privacy')}
                            </a>
                            {' · '}
                            <a href={dataCollectionUrl} target="_blank" rel="noopener noreferrer">
                                {t('locator.binding.dataCollection') || 'Data Collection'}
                            </a>
                            {' · '}
                            <a href={disclaimerUrl} target="_blank" rel="noopener noreferrer">
                                {t('locator.binding.disclaimer')}
                            </a>
                        </span>
                    </div>
                    <div className={classNames(profileStyles.profileActions, styles.singleAction)}>
                        {(!bindingStatus?.bound || replaceMode) && (
                            <AccessButton
                                onClick={() => {
                                    void handleBind();
                                }}
                                disabled={loading || countdown > 0}
                                label={loading
                                    ? (t('common.loading'))
                                    : bindLabel}
                            />
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default React.memo(LocatorButton);

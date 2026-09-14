import React, { useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import Modal, { type ModalProps } from '@/component/modal/modal';
import { AccessButton } from '@/component/login/access';
import PopoverTooltip from '@/component/popover/popover';
import { TabView, type TabViewItem } from '@/component/tabView';
import { useAuthStore } from '@/store/auth';
import { useLocale, useTranslateUI } from '@/locale';
import { docsLinks as makeDocsLinks, linksTpl } from '@/lib/i18n/docsLink';
import {
    bindEFRole,
    exchangeEFToken,
    type EFBindingSummary,
    type EFRoleOption,
} from '@/services/endfield';
import { readEFTrackerConf } from '@/services/endfield';
import { setCachedBinding } from '@/services/cache/backend';
import profileStyles from '@/component/login/profile/profile.module.scss';
import BindingIcon from '@/assets/logos/binding.svg?react';
import {
    inferLocatorAccountModeFromBaseUrl,
    type LocatorAccountMode,
} from './endfieldHosts';
import {
    applyRole,
    cleanToken,
    extractToken,
} from './session';
import styles from './Locator.module.scss';

const BIND_COUNTDOWN_SECONDS = 5;
const SKLAND_DEVICE_VERIFICATION_ERROR = '需要进行设备验证';

interface LocationBindingProps {
    open: boolean;
    onClose: () => void;
    onBound?: (binding: EFBindingSummary) => void;
    modalSize?: ModalProps['size'];
    enableLocatorOnBound?: boolean;
}

const LocationBinding: React.FC<LocationBindingProps> = ({
    open,
    onClose,
    onBound,
    modalSize = 'l',
    enableLocatorOnBound = true,
}) => {
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
    const errorText = error ?? '';
    const shouldShowError = open && Boolean(errorText);
    const isErrorRemoved = !shouldShowError;
    const isSklandDeviceVerificationError = accountMode === 'skland'
        && errorText === SKLAND_DEVICE_VERIFICATION_ERROR;

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
        if (enableLocatorOnBound) {
            applyRole(mode, role);
        }
        onBound?.(binding);
        close();
    }, [close, enableLocatorOnBound, onBound, sessionUser?.uid]);

    const loadRoles = useCallback(async (
        nextFlowId: string,
        roles: EFRoleOption[],
        mode: LocatorAccountMode,
    ) => {
        if (!roles.length) {
            throw new Error(t('locator.errors.noRole'));
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
    }, [finishBind, t]);

    const bindByToken = useCallback(async () => {
        const accountToken = extractToken(tokenInput);
        if (!accountToken) {
            setError(t('locator.errors.tokenRequired'));
            return;
        }

        const exchanged = await exchangeEFToken(accountMode, accountToken);
        await loadRoles(exchanged.flowId, exchanged.roles, accountMode);
    }, [accountMode, t, loadRoles, tokenInput]);

    const confirmRole = useCallback(async () => {
        const role = roleOptions.find((item) => `${item.serverId}:${item.roleId}` === selectedRoleKey);
        if (!role || !flowId) {
            setError(t('locator.errors.roleRequired'));

            return;
        }
        const result = await bindEFRole(flowId, role);
        finishBind(accountMode, role, result.binding);
    }, [accountMode, finishBind, flowId, t, roleOptions, selectedRoleKey]);

    const handleBind = useCallback(async () => {
        if (loading || countdown > 0) return;
        setError('');
        setLoading(true);
        try {
            if (step === 'auth') await bindByToken();
            else await confirmRole();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('locator.errors.bindingFailed'));
        } finally {
            setLoading(false);
        }
    }, [bindByToken, confirmRole, countdown, t, loading, step]);

    const switchMode = useCallback((mode: LocatorAccountMode) => {
        setAccountMode(mode);
        setError('');
        setTokenInput('');
        setStep('auth');
        setRoleOptions([]);
        setSelectedRoleKey('');
        setFlowId('');
    }, []);

    const providerInfo = useMemo(() => ({
        skland: {
            link: 'https://www.skland.com',
            officialLink: 'https://endfield.hypergryph.com',
            apiLink: 'https://web-api.hypergryph.com/account/info/hg',
        },
        skport: {
            link: 'https://www.skport.com',
            officialLink: 'https://endfield.gryphline.com',
            apiLink: 'https://web-api.gryphline.com/cookie_store/account_token',
        },
    } as const), []);

    const providerName = accountMode === 'skport'
        ? 'SKPORT'
        : locale.toLowerCase().startsWith('zh-cn')
            ? '\u68ee\u7a7a\u5c9b'
            : locale.toLowerCase().startsWith('zh-hk')
                ? '\u68ee\u7a7a\u5cf6'
                : 'SKLAND';
    const premiseText = useMemo(() => (
        t('locator.binding.premise').replace('{provider}', providerName)
    ), [providerName, t]);

    const tabItems: TabViewItem[] = useMemo(() => [
        {
            key: 'skland',
            label: t('locator.binding.chinaTab'),
            description: (
                <ol className={styles.bindStep}>
                    <li>{linksTpl(t('locator.binding.Step0'), { link: providerInfo.skland.officialLink })}</li>
                    <li>{linksTpl(t('locator.binding.Step1.skland'), { link: providerInfo.skland.apiLink })}</li>
                    <li>{t('locator.binding.Step2')}</li>
                </ol>
            ),
        },
        {
            key: 'skport',
            label: t('locator.binding.globalTab'),
            description: (
                <ol className={styles.bindStep}>
                    <li>{linksTpl(t('locator.binding.Step0'), { link: providerInfo.skport.officialLink })}</li>
                    <li>{linksTpl(t('locator.binding.Step1.skport'), { link: providerInfo.skport.apiLink })}</li>
                    <li>{t('locator.binding.Step2')}</li>
                </ol>
            ),
        },
    ], [providerInfo, t]);

    const bindLabelTemplate = enableLocatorOnBound
        ? t('locator.binding.bindWithCountdown')
        : t('locator.binding.bindOnlyWithCountdown');
    const bindLabel = countdown > 0
        ? bindLabelTemplate.replace('{sec}', String(countdown))
        : enableLocatorOnBound
            ? t('locator.binding.bind')
            : t('locator.binding.bindOnly');
    const docLinks = useMemo(() => makeDocsLinks(locale), [locale]);
    const docsText = useMemo(() => (
        linksTpl(
            t('locator.binding.docsLinks'),
            {
                tos: docLinks.tos,
                privacy: docLinks.privacy,
                data: docLinks.dataCollection,
                disclaimer: docLinks.disclaimer,
            },
        )
    ), [docLinks, t]);

    return (
        <Modal
            open={open}
            size={modalSize}
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
                                        {role.serverName || role.serverType || `${t('locator.config.server')} ${role.serverId}`}
                                        {' · '}
                                        {'Lv.'}
                                        {role.level}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                <div
                    className={classNames(styles.bindingError, isSklandDeviceVerificationError && styles.bindingErrorRich)}
                    data-removed={isErrorRemoved ? 'true' : 'false'}
                    data-text={isSklandDeviceVerificationError ? '' : errorText}
                    aria-live="polite"
                >
                    {isSklandDeviceVerificationError ? (
                        <>
                            <span>{SKLAND_DEVICE_VERIFICATION_ERROR}。</span>
                            {' '}
                            <span className={styles.policyReminder}>
                                <PopoverTooltip
                                    placement="top"
                                    gap={8}
                                    content={(
                                        <span className={styles.deviceVerificationPopover}>
                                            注册/登录<span className="keyword">森空岛</span> » 右上角<span className="keyword">设置</span> » 通行证与账号安全 » 账号安全管理 » 设备管理 » 关闭<span className="keyword">新设备登录身份验证</span>
                                        </span>
                                    )}
                                >
                                    <a
                                        href="#device-verification-help"
                                        onClick={(event) => event.preventDefault()}
                                    >
                                        如何解决？
                                    </a>
                                </PopoverTooltip>
                            </span>
                        </>
                    ) : errorText}
                </div>

                <div className={styles.bindingFooter}>
                    <div className={styles.policyReminder}>
                        <span>{linksTpl(premiseText, { link: providerInfo[accountMode].link })}</span>
                        <span>{t('locator.binding.docsLead')}</span>
                        <span>{docsText}</span>
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

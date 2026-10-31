import IconButton from '@/component/button/IconButton';
import { useRetryImport } from '@/lib/dom/useRetryImport';
import ErrorBoundary from '@/component/shared/ErrorBoundary';
import Modal from '@/component/modal/modal';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { OEM_AUTH_DISMISS_EVENT, openOemAuthModal } from '@/component/shared/account/authEvents';
import { useAuthStore } from '@/store/auth';
import { useTranslateUI } from '@/locale';
import { getCachedBinding, setCachedBinding } from '@/services/cache/backend';
import { SubregionSwitch } from '@/pages/regSwitch/regSwitch';
import { useSwitchMenu } from '@/pages/regSwitch/useSwitchMenu';
import PopoverTooltip from '@/component/popover/popover';
import regSwitchStyles from '@/pages/regSwitch/regSwitch.module.scss';
import styles from '@/pages/locator/Locator.module.scss';
import LocateCloseIcon from '@/assets/images/UI/locateclose.svg?react';
import LocateOpenIcon from '@/assets/images/UI/locateopen.svg?react';
import LocateCurrentIcon from '@/assets/images/UI/locatecurrent.svg?react';
import ConfigIcon from '@/assets/images/UI/config.svg?react';
import { disableSession, enableSession } from '@/pages/locator/session';
import { useRequestOwner } from './useRequestOwner';
import { isBindingUnauthorized, loadBindingStatus } from './bindingStatus';
import {
    requestLocatorReturnCurrent,
    useLocatorStore,
    type LocatorViewMode,
} from '@/store/locator';

type LocatorButtonVariant = 'desktop' | 'mobile';

const resolveIcon = (viewMode: LocatorViewMode): React.FC =>
    viewMode === 'tracking'
        ? LocateOpenIcon
        : viewMode === 'detached'
            ? LocateCurrentIcon
            : LocateCloseIcon;

interface LocatorButtonProps {
    variant?: LocatorButtonVariant;
    isSidebarOpen?: boolean;
}

const loadBinding = () => import('@/pages/locator/LocationBinding');
const loadConfig = () => import('@/pages/locator/LocationConfig');

const LocatorButton: React.FC<LocatorButtonProps> = ({ variant = 'desktop', isSidebarOpen = false }) => {
    const t = useTranslateUI();
    const sessionUser = useAuthStore((state) => state.sessionUser);
    const captureOwner = useRequestOwner();
    const statusRequest = useRef(0);
    const activationRequest = useRef(0);
    const statusController = useRef<AbortController | null>(null);
    const mobileController = useRef<AbortController | null>(null);
    const activationController = useRef<AbortController | null>(null);
    const loginRequested = useRef<number | null>(null);
    const uid = sessionUser?.uid;
    const viewMode = useLocatorStore((state) => state.viewMode);
    const bindReq = useLocatorStore((state) => state.bindReq);
    const cachedBinding = useMemo(() => getCachedBinding(uid), [uid]);
    const [bindingOpen, setBindingOpen] = useState(false);
    const [bindingMounted, setBindingMounted] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [configMounted, setConfigMounted] = useState(false);
    const LocationBinding = useRetryImport(loadBinding, bindingOpen)?.default;
    const LocationConfig = useRetryImport(loadConfig, configOpen)?.default;
    const [mobileExpanded, setMobileExpanded] = useState(false);
    const [pendingAfterLogin, setPendingAfterLogin] = useState(false);
    const [actionPending, setActionPending] = useState(false);
    const [bound, setBound] = useState(Boolean(cachedBinding.value?.bound));
    const menu = useSwitchMenu(bound && variant === 'desktop');
    const mobileShellRef = useRef<HTMLDivElement | null>(null);
    const mobilePrimaryButtonRef = useRef<HTMLButtonElement | null>(null);

    const resetMobileShellScroll = useCallback(() => {
        if (!mobileShellRef.current) return;
        mobileShellRef.current.scrollLeft = 0;
    }, []);

    const collapseMobileShell = useCallback(() => {
        setMobileExpanded(false);
        requestAnimationFrame(resetMobileShellScroll);
    }, [resetMobileShellScroll]);

    const focusMobilePrimaryButton = useCallback(() => {
        requestAnimationFrame(() => {
            resetMobileShellScroll();
            mobilePrimaryButtonRef.current?.focus({ preventScroll: true });
        });
    }, [resetMobileShellScroll]);

    useEffect(() => {
        const dismissed = () => { loginRequested.current = null; };
        window.addEventListener(OEM_AUTH_DISMISS_EVENT, dismissed);
        return () => { window.removeEventListener(OEM_AUTH_DISMISS_EVENT, dismissed); };
    }, []);

    const requestLogin = useCallback((resume: boolean) => {
        if (resume) setPendingAfterLogin(true);
        const version = useAuthStore.getState().sessionVersion;
        if (loginRequested.current === version) return;
        loginRequested.current = version;
        openOemAuthModal('login');
    }, []);

    useEffect(() => {
        setActionPending(false);
        return () => {
            statusController.current?.abort();
            mobileController.current?.abort();
            activationController.current?.abort();
            mobileController.current = null;
            activationController.current = null;
        };
    }, [captureOwner]);

    const refreshBindingStatus = useCallback(() => {
        if (!sessionUser) {
            setBound(false);
            return;
        }
        statusController.current?.abort();
        const controller = new AbortController();
        statusController.current = controller;
        const ownerCurrent = captureOwner();
        const request = ++statusRequest.current;
        const isCurrent = () => !controller.signal.aborted && ownerCurrent() && statusRequest.current === request;
        if (!isCurrent()) return;
        void loadBindingStatus(controller.signal)
            .then((status) => {
                if (!isCurrent()) return;
                setCachedBinding(sessionUser.uid, status.binding);
                setBound(Boolean(status.binding.bound));
            })
            .catch((error: unknown) => {
                if (isCurrent() && isBindingUnauthorized(error)) requestLogin(false);
            });
        return () => { controller.abort(); };
    }, [captureOwner, requestLogin, sessionUser]);

    useEffect(() => {
        if (!sessionUser) {
            setBound(false);
            return;
        }
        setBound(Boolean(cachedBinding.value?.bound));
    }, [cachedBinding.value?.bound, captureOwner, sessionUser]);

    useEffect(() => {
        return refreshBindingStatus();
    }, [refreshBindingStatus]);

    useEffect(() => {
        if (!mobileExpanded) return;

        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            if (mobileShellRef.current?.contains(event.target as Node)) return;
            collapseMobileShell();
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [collapseMobileShell, mobileExpanded]);

    useEffect(() => {
        if (mobileExpanded) return;
        const raf = requestAnimationFrame(resetMobileShellScroll);
        return () => cancelAnimationFrame(raf);
    }, [mobileExpanded, resetMobileShellScroll]);

    useEffect(() => {
        if (bindReq <= 0) return;
        setBindingOpen(true);
        setConfigOpen(false);
        refreshBindingStatus();
    }, [bindReq, refreshBindingStatus]);

    useEffect(() => {
        if (bindingOpen) {
            setBindingMounted(true);
        }
    }, [bindingOpen]);

    useEffect(() => {
        if (configOpen) {
            setConfigMounted(true);
        }
    }, [configOpen]);

    const startSession = useCallback(() => {
        if (activationController.current) return;
        const controller = new AbortController();
        activationController.current = controller;
        const ownerCurrent = captureOwner();
        const request = ++activationRequest.current;
        const isCurrent = () => !controller.signal.aborted && ownerCurrent() && activationRequest.current === request;
        if (!isCurrent()) return;
        setActionPending(true);
        void enableSession(isCurrent, controller.signal).then((enabled) => {
            if (!isCurrent() || enabled === undefined) return;
            setBound((current) => enabled || current);
            if (!enabled) {
                setBindingOpen(true);
            }
        }).catch((error: unknown) => {
            if (isCurrent() && isBindingUnauthorized(error)) requestLogin(true);
        }).finally(() => {
            if (activationController.current === controller) {
                activationController.current = null;
                if (ownerCurrent()) setActionPending(false);
            }
        });
    }, [captureOwner, requestLogin]);

    useEffect(() => {
        if (!pendingAfterLogin || !sessionUser || loginRequested.current === useAuthStore.getState().sessionVersion) return;
        setPendingAfterLogin(false);
        startSession();
    }, [pendingAfterLogin, sessionUser, startSession]);

    const handleClick = useCallback(() => {
        if (viewMode === 'detached') {
            ++activationRequest.current;
            requestLocatorReturnCurrent();
            useLocatorStore.getState().setViewMode('tracking');
            return;
        }

        if (viewMode === 'tracking') {
            ++activationRequest.current;
            disableSession();
            return;
        }

        if (!sessionUser) {
            requestLogin(true);
            return;
        }

        startSession();
    }, [requestLogin, sessionUser, startSession, viewMode]);

    const handleMobileClick = useCallback(() => {
        if (mobileExpanded) {
            collapseMobileShell();
            handleClick();
            return;
        }

        if (!sessionUser) {
            requestLogin(true);
            return;
        }

        if (bound) {
            setMobileExpanded(true);
            return;
        }

        if (mobileController.current) return;
        const controller = new AbortController();
        mobileController.current = controller;
        const ownerCurrent = captureOwner();
        const isCurrent = () => !controller.signal.aborted && ownerCurrent();
        if (!isCurrent()) return;
        setActionPending(true);
        void loadBindingStatus(controller.signal)
            .then((status) => {
                if (!isCurrent()) return;
                setCachedBinding(sessionUser.uid, status.binding);
                const isBound = Boolean(status.binding.bound);
                setBound(isBound);
                if (isBound) {
                    setMobileExpanded(true);
                    return;
                }
                setBindingOpen(true);
            })
            .catch((error: unknown) => {
                if (isCurrent() && isBindingUnauthorized(error)) requestLogin(true);
            }).finally(() => {
                if (mobileController.current === controller) {
                    mobileController.current = null;
                    if (ownerCurrent()) setActionPending(false);
                }
            });
    }, [bound, captureOwner, collapseMobileShell, handleClick, mobileExpanded, requestLogin, sessionUser]);

    const Icon = resolveIcon(viewMode);

    const pendingModal = (bindingOpen && !LocationBinding) || (configOpen && !LocationConfig) ? (
        <Modal open size={variant === 'mobile' ? 'full' : 'l'} onChange={(next) => {
            if (!next) { setBindingOpen(false); setConfigOpen(false); }
        }}>
            <p role="status">{t('common.loading')}</p>
        </Modal>
    ) : null;

    if (variant === 'mobile') {
        return (
            <>
                <div
                    ref={mobileShellRef}
                    className={styles.mobileLocatorShell}
                    data-expanded={mobileExpanded ? 'true' : 'false'}
                    data-guide="mobile-locator-shell"
                >
                    <button
                        ref={mobilePrimaryButtonRef}
                        type="button"
                        className={styles.mobileLocatorButton}
                        data-active={viewMode !== 'off'}
                        onClick={handleMobileClick}
                        aria-label={t('locator.title')}
                        aria-busy={actionPending}
                    >
                        <Icon />
                    </button>
                    <button
                        type="button"
                        className={styles.mobileLocatorConfigButton}
                        onClick={(event) => {
                            event.currentTarget.blur();
                            collapseMobileShell();
                            setConfigOpen(true);
                        }}
                        aria-label={t('locator.config.title')}
                        tabIndex={mobileExpanded ? 0 : -1}
                    >
                        <ConfigIcon />
                    </button>
                </div>
                {pendingModal}
                {bindingMounted && LocationBinding && (
                    <ErrorBoundary resetKeys={[bindingOpen, configOpen]}>
                        <LocationBinding
                            open={bindingOpen}
                            modalSize="full"
                            onClose={() => {
                                setBindingOpen(false);
                                refreshBindingStatus();
                                focusMobilePrimaryButton();
                            }}
                            onBound={() => {
                                setBound(true);
                                refreshBindingStatus();
                            }}
                        />
                    </ErrorBoundary>
                )}
                {configMounted && LocationConfig && (
                    <ErrorBoundary resetKeys={[bindingOpen, configOpen]}>
                        <LocationConfig
                            open={configOpen}
                            onClose={() => {
                                setConfigOpen(false);
                                refreshBindingStatus();
                                focusMobilePrimaryButton();
                            }}
                            onChangeBinding={() => {
                                setConfigOpen(false);
                                setBindingOpen(true);
                            }}
                            onBindingRemoved={() => {
                                setBound(false);
                                collapseMobileShell();
                            }}
                        />
                    </ErrorBoundary>
                )}
            </>
        );
    }

    return (
        <>
            <div ref={menu.ref} className={classNames(regSwitchStyles.regswitch, styles.locatorSwitch)}>
                <PopoverTooltip
                    content={t('mapControls.locationTracking')}
                    placement="left"
                    disabled={!isSidebarOpen}
                >
                    <div
                        {...menu.getItemProps('locator')}
                        className={classNames(
                            regSwitchStyles.regItem,
                            styles.locatorButton,
                            viewMode !== 'off' && regSwitchStyles.selected,
                        )}
                    >
                        <IconButton className={regSwitchStyles.mainAction} data-guide="locator-button" label={t('mapControls.locationTracking')} pressed={viewMode !== 'off'} aria-busy={actionPending} onClick={() => {
                            menu.open('locator');
                            handleClick();
                        }}>
                            <div className={regSwitchStyles.icon}><Icon /></div>
                        </IconButton>
                        {bound && (
                            <SubregionSwitch
                                open={menu.activeKey === 'locator'}
                                showIndicator={false}
                                items={[
                                    {
                                        key: 'binding',
                                        icon: ConfigIcon,
                                        tooltip: t('locator.config.title'),
                                        ariaLabel: t('locator.config.title'),
                                        onClick: () => setConfigOpen(true),
                                    },
                                ]}
                            />
                        )}
                    </div>
                </PopoverTooltip>
            </div>
            {pendingModal}
            {bindingMounted && LocationBinding && (
                <ErrorBoundary resetKeys={[bindingOpen, configOpen]}>
                    <LocationBinding
                        open={bindingOpen}
                        onClose={() => {
                            setBindingOpen(false);
                            refreshBindingStatus();
                        }}
                        onBound={() => {
                            setBound(true);
                            refreshBindingStatus();
                        }}
                    />
                </ErrorBoundary>
            )}
            {configMounted && LocationConfig && (
                <ErrorBoundary resetKeys={[bindingOpen, configOpen]}>
                    <LocationConfig
                        open={configOpen}
                        onClose={() => {
                            setConfigOpen(false);
                            refreshBindingStatus();
                        }}
                        onChangeBinding={() => {
                            setConfigOpen(false);
                            setBindingOpen(true);
                        }}
                        onBindingRemoved={() => {
                            setBound(false);
                            setMobileExpanded(false);
                        }}
                    />
                </ErrorBoundary>
            )}
        </>
    );
};

export default React.memo(LocatorButton);

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { openOemAuthModal } from '@/component/login/authEvents';
import { useAuthStore } from '@/store/auth';
import { useTranslateUI } from '@/locale';
import { getEFBindingStatus } from '@/utils/endfield/backendClient';
import { getCachedBinding, setCachedBinding } from '@/utils/backendCache';
import { SubregionSwitch } from '@/component/regSwitch/regSwitch';
import regSwitchStyles from '@/component/regSwitch/regSwitch.module.scss';
import styles from './Locator.module.scss';
import LocateCloseIcon from '@/assets/images/UI/locateclose.svg?react';
import LocateOpenIcon from '@/assets/images/UI/locateopen.svg?react';
import LocateCurrentIcon from '@/assets/images/UI/locatecurrent.svg?react';
import ConfigIcon from '@/assets/images/UI/config.svg?react';
import { disableSession, enableSession } from './session';
import {
    requestLocatorReturnCurrent,
    useLocatorStore,
    type LocatorViewMode,
} from './state';

type LocatorButtonVariant = 'desktop' | 'mobile';

const resolveIcon = (viewMode: LocatorViewMode): React.FC =>
    viewMode === 'tracking'
        ? LocateOpenIcon
        : viewMode === 'detached'
            ? LocateCurrentIcon
            : LocateCloseIcon;

interface LocatorButtonProps {
    variant?: LocatorButtonVariant;
}

const LocationBinding = lazy(() => import('./LocationBinding'));
const LocationConfig = lazy(() => import('./LocationConfig'));

const LocatorButton: React.FC<LocatorButtonProps> = ({ variant = 'desktop' }) => {
    const t = useTranslateUI();
    const sessionUser = useAuthStore((state) => state.sessionUser);
    const uid = sessionUser?.uid;
    const viewMode = useLocatorStore((state) => state.viewMode);
    const bindReq = useLocatorStore((state) => state.bindReq);
    const cachedBinding = useMemo(() => getCachedBinding(uid), [uid]);
    const [bindingOpen, setBindingOpen] = useState(false);
    const [bindingMounted, setBindingMounted] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [configMounted, setConfigMounted] = useState(false);
    const [mobileExpanded, setMobileExpanded] = useState(false);
    const [pendingAfterLogin, setPendingAfterLogin] = useState(false);
    const [bound, setBound] = useState(Boolean(cachedBinding.value?.bound));
    const mobileShellRef = useRef<HTMLDivElement | null>(null);

    const refreshBindingStatus = useCallback(() => {
        if (!sessionUser) {
            setBound(false);
            return;
        }
        void getEFBindingStatus()
            .then((status) => {
                setCachedBinding(sessionUser.uid, status.binding);
                setBound(Boolean(status.binding.bound));
            })
            .catch(() => setBound(false));
    }, [sessionUser]);

    useEffect(() => {
        if (!sessionUser) {
            setBound(false);
            return;
        }
        if (cachedBinding.hit) {
            setBound(Boolean(cachedBinding.value?.bound));
        }
    }, [cachedBinding.hit, cachedBinding.value?.bound, sessionUser]);

    useEffect(() => {
        refreshBindingStatus();
    }, [refreshBindingStatus]);

    useEffect(() => {
        if (!mobileExpanded) return;

        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            if (mobileShellRef.current?.contains(event.target as Node)) return;
            setMobileExpanded(false);
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [mobileExpanded]);

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

    useEffect(() => {
        if (!pendingAfterLogin || !sessionUser) return;
        setPendingAfterLogin(false);
        void enableSession().then((enabled) => {
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
            disableSession();
            return;
        }

        if (!sessionUser) {
            setPendingAfterLogin(true);
            openOemAuthModal('login');
            return;
        }

        void enableSession().then((enabled) => {
            setBound((current) => enabled || current);
            if (!enabled) {
                setBindingOpen(true);
            }
        }).catch(() => {
            setBindingOpen(true);
        });
    }, [sessionUser, viewMode]);

    const handleMobileClick = useCallback(() => {
        if (mobileExpanded) {
            setMobileExpanded(false);
            handleClick();
            return;
        }

        if (!sessionUser) {
            setPendingAfterLogin(true);
            openOemAuthModal('login');
            return;
        }

        if (bound) {
            setMobileExpanded(true);
            return;
        }

        void getEFBindingStatus()
            .then((status) => {
                setCachedBinding(sessionUser.uid, status.binding);
                const isBound = Boolean(status.binding.bound);
                setBound(isBound);
                if (isBound) {
                    setMobileExpanded(true);
                    return;
                }
                setBindingOpen(true);
            })
            .catch(() => {
                setBound(false);
                setBindingOpen(true);
            });
    }, [bound, handleClick, mobileExpanded, sessionUser]);

    const Icon = resolveIcon(viewMode);

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
                        type="button"
                        className={styles.mobileLocatorButton}
                        data-active={viewMode !== 'off'}
                        onClick={handleMobileClick}
                        aria-label={t('locator.title') || 'Locator'}
                    >
                        <Icon />
                    </button>
                    <button
                        type="button"
                        className={styles.mobileLocatorConfigButton}
                        onClick={() => {
                            setMobileExpanded(false);
                            setConfigOpen(true);
                        }}
                        aria-label={t('locator.config.title') || 'Tracking Config'}
                        tabIndex={mobileExpanded ? 0 : -1}
                    >
                        <ConfigIcon />
                    </button>
                </div>
                {bindingMounted && (
                    <Suspense fallback={null}>
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
                    </Suspense>
                )}
                {configMounted && (
                    <Suspense fallback={null}>
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
                    </Suspense>
                )}
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
                    data-guide="locator-button"
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
                                    icon: ConfigIcon,
                                    tooltip: t('locator.config.title'),
                                    ariaLabel: t('locator.config.title'),
                                    onClick: () => setConfigOpen(true),
                                },
                            ]}
                        />
                    )}
                </div>
            </div>
            {bindingMounted && (
                <Suspense fallback={null}>
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
                </Suspense>
            )}
            {configMounted && (
                <Suspense fallback={null}>
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
                </Suspense>
            )}
        </>
    );
};

export default React.memo(LocatorButton);

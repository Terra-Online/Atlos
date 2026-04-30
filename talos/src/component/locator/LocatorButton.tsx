import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import BindingIcon from '@/assets/logos/binding.svg?react';
import LocationBinding from './LocationBinding';
import LocationConfig from './LocationConfig';
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

const LocatorButton: React.FC<LocatorButtonProps> = ({ variant = 'desktop' }) => {
    const t = useTranslateUI();
    const sessionUser = useAuthStore((state) => state.sessionUser);
    const uid = sessionUser?.uid;
    const viewMode = useLocatorStore((state) => state.viewMode);
    const bindReq = useLocatorStore((state) => state.bindReq);
    const cachedBinding = useMemo(() => getCachedBinding(uid), [uid]);
    const [bindingOpen, setBindingOpen] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [pendingAfterLogin, setPendingAfterLogin] = useState(false);
    const [bound, setBound] = useState(Boolean(cachedBinding.value?.bound));

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
        if (bindReq <= 0) return;
        setBindingOpen(true);
        setConfigOpen(false);
        refreshBindingStatus();
    }, [bindReq, refreshBindingStatus]);

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
                                    onClick: () => setConfigOpen(true),
                                },
                            ]}
                        />
                    )}
                </div>
            </div>
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
                }}
            />
        </>
    );
};

export default React.memo(LocatorButton);

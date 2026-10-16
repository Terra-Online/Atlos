import { useEffect, useRef, useState } from 'react';
import AuthLoader from './components/authLoader';
import { loadAuthGate } from './components/authEntry';
import { clearReadCache, getOverview, isUnauthorized } from './api/client';
import type { Overview } from './types';
import type { SessionUser } from '@main/services/auth';
import { useAuthStore } from '@main/store/auth';
import Header from './components/header/header';
import IDCard from './components/idcard/idcard';
import Nav from './components/nav/nav';
import Profile from './components/profile/profile';
import Content from './components/content/content';
import { tabFromPath, pathForTab, type Tab } from './routing';
import { translateUI, useTranslateUI } from '@hub/locale';
import { useTranslateUI as useTranslateMainUI } from '@main/locale';

function useAccount() {
    const [overview, setOverview] = useState<Overview | null>(null);
    const [revision, setRevision] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [unauthorized, setUnauthorized] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        void getOverview(controller.signal)
            .then((result) => {
                if (!controller.signal.aborted) {
                    setOverview(result);
                    setUnauthorized(false);
                }
            })
            .catch((cause: unknown) => {
                if (controller.signal.aborted) return;
                if (isUnauthorized(cause)) {
                    // Begin the conditional download before React commits the error UI.
                    void loadAuthGate().catch(() => undefined);
                    useAuthStore.getState().clearSessionUser();
                    setOverview(null);
                    setUnauthorized(true);
                    return;
                }
                setError(
                    cause instanceof Error
                        ? cause.message
                        : translateUI('userHub.loadError'),
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [revision]);

    const refresh = () => {
        clearReadCache();
        setUnauthorized(false);
        setRevision((value) => value + 1);
    };
    const updateUser = (user: SessionUser) => {
        setOverview((previous) =>
            previous ? { ...previous, user } : previous,
        );
    };

    return {
        overview,
        revision,
        loading,
        error,
        unauthorized,
        busy: loading,
        refresh,
        updateUser,
    };
}

export default function App() {
    const t = useTranslateUI();
    const main = useTranslateMainUI();
    const pageTitle = t('userHub.pageTitle').replace(
        '{site}',
        main('meta.title'),
    );
    const [active, setActive] = useState<Tab>(tabFromPath);
    const attemptedSession = useRef<string | null>(null);
    const {
        overview, revision, loading, error, unauthorized, busy, refresh,
        updateUser,
    } = useAccount();

    useEffect(() => {
        if (overview) attemptedSession.current = null;
    }, [overview]);

    useEffect(() => {
        if (pageTitle) document.title = pageTitle;
    }, [pageTitle]);

    useEffect(() => {
        const onPopState = () => {
            const tab = tabFromPath();
            if (window.location.pathname !== pathForTab(tab)) {
                window.history.replaceState(
                    window.history.state,
                    '',
                    `${pathForTab(tab)}${window.location.search}${window.location.hash}`,
                );
            }
            setActive(tab);
        };
        onPopState();
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    return (
        <div className='app' data-app='user-hub'>
            <div className='hubFrame'>
                <Header busy={busy} onRefresh={refresh} />
                <div className='hubLayout'>
                    <aside className='hubSidebar'>
                        {overview && <IDCard overview={overview} />}
                        <Nav active={active} />
                    </aside>
                    <main className='hubContent' aria-busy={busy}>
                        {error && (
                            <div className='hubError' role='alert'>
                                {error}
                            </div>
                        )}
                        {loading && !overview && (
                            <p className='hubLoading' role='status'>
                                {t('common.loading')}
                            </p>
                        )}
                        {unauthorized && <AuthLoader onAuthenticated={refresh} attemptedSession={attemptedSession} />}
                        {overview &&
                            (active === 'contributions' ? (
                                <Content
                                    revision={revision}
                                    counts={overview.contributions}
                                />
                            ) : (
                                <Profile
                                    user={overview.user}
                                    onSaved={updateUser}
                                />
                            ))}
                    </main>
                </div>
            </div>
        </div>
    );
}

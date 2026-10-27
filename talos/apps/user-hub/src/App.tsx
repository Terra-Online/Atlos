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
    const [ownerEpoch, setOwnerEpoch] = useState(0);
    const epoch = useRef(0);
    const request = useRef<AbortController | null>(null);
    const currentOverview = useRef<Overview | null>(null);
    const adopting = useRef(false);
    const awaitingAuth = useRef(false);
    const recoveringContent = useRef(false);

    useEffect(() => useAuthStore.subscribe((state, previous) => {
        const uid = state.sessionUser?.uid ?? null;
        const sameUid = uid === (previous.sessionUser?.uid ?? null);
        if (adopting.current || awaitingAuth.current) return;
        // A settled page keeps same-account avatar updates local. A pending
        // overview, however, predates the newly committed identity and may
        // contain an obsolete profile or 401; it must be replaced, not reused.
        if (sameUid && (!request.current || state.sessionUser === previous.sessionUser)) return;
        if (recoveringContent.current && (!uid || uid === currentOverview.current?.user.uid)) return;
        // The subscription observes every boundary, including batched A-B-A
        // transitions whose final uid is indistinguishable to a uid selector.
        epoch.current += 1;
        request.current?.abort();
        if (sameUid) clearReadCache();
        else {
            currentOverview.current = null;
            setOverview(null);
        }
        if (!recoveringContent.current) setOwnerEpoch(epoch.current);
    }), []);

    useEffect(() => {
        const controller = new AbortController();
        request.current = controller;
        const requestEpoch = epoch.current;
        const isCurrent = () => !controller.signal.aborted && requestEpoch === epoch.current;
        setLoading(true);
        setError(null);
        void getOverview(controller.signal)
            .then((result) => {
                if (isCurrent()) {
                    // The overview response is authoritative when a valid
                    // cookie exists but no session identity was cached locally.
                    if (useAuthStore.getState().sessionUser?.uid !== result.user.uid) {
                        adopting.current = true;
                        useAuthStore.getState().setSessionUser(result.user);
                        adopting.current = false;
                    }
                    currentOverview.current = result;
                    setOverview(result);
                    awaitingAuth.current = false;
                    setUnauthorized(false);
                }
            })
            .catch((cause: unknown) => {
                if (!isCurrent()) return;
                if (isUnauthorized(cause)) {
                    // Begin the conditional download before React commits the error UI.
                    void loadAuthGate().catch(() => undefined);
                    awaitingAuth.current = true;
                    useAuthStore.getState().clearSessionUser();
                    currentOverview.current = null;
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
                if (isCurrent()) setLoading(false);
                if (request.current === controller) request.current = null;
            });
        return () => controller.abort();
    }, [ownerEpoch, revision]);

    const refresh = () => {
        clearReadCache();
        awaitingAuth.current = false;
        recoveringContent.current = false;
        setUnauthorized(false);
        setRevision((value) => value + 1);
    };
    const updateUser = (user: SessionUser) => {
        setOverview((previous) =>
            previous?.user.uid === user.uid ? { ...previous, user } : previous,
        );
    };
    const beginContentAuth = () => {
        recoveringContent.current = true;
        request.current?.abort();
        setLoading(false);
        useAuthStore.getState().clearSessionUser();
    };
    const finishContentAuth = () => {
        recoveringContent.current = false;
        return Boolean(currentOverview.current
            && currentOverview.current.user.uid === useAuthStore.getState().sessionUser?.uid);
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
        beginContentAuth,
        finishContentAuth,
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
    const [contentAuthRequired, setContentAuthRequired] = useState(false);
    const [contentAuthRevision, setContentAuthRevision] = useState(0);
    const {
        overview, revision, loading, error, unauthorized, busy, refresh,
        updateUser,
        beginContentAuth,
        finishContentAuth,
    } = useAccount();

    // The auth gate is only needed on the common signed-out path. Start its
    // module request alongside overview so a 401 does not create a long tail
    // of JS/CSS and font requests after the page has already rendered.
    useEffect(() => {
        if (!useAuthStore.getState().sessionUser) {
            void loadAuthGate().catch(() => undefined);
        }
    }, []);

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
                        {overview && !contentAuthRequired && <IDCard overview={overview} />}
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
                        {(unauthorized || contentAuthRequired) && <AuthLoader onAuthenticated={() => {
                            setContentAuthRequired(false);
                            if (contentAuthRequired && finishContentAuth()) {
                                setContentAuthRevision((value) => value + 1);
                            } else refresh();
                        }} attemptedSession={attemptedSession} />}
                        {overview && <div hidden={contentAuthRequired}>
                            {active === 'contributions' ? (
                                <Content
                                    revision={revision}
                                    counts={overview.contributions}
                                    authRevision={contentAuthRevision}
                                    onUnauthorized={() => {
                                        attemptedSession.current = null;
                                        setContentAuthRequired(true);
                                        beginContentAuth();
                                    }}
                                />
                            ) : (
                                <Profile
                                    user={overview.user}
                                    onSaved={updateUser}
                                />
                            )}
                        </div>}
                    </main>
                </div>
            </div>
        </div>
    );
}

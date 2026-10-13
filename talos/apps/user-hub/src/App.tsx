import { useEffect, useRef, useState } from 'react';
import {
    getOverview,
    isUnauthorized,
    linkSocial,
    unlinkAccount,
    unlinkEndfieldBinding,
} from './api/client';
import type { Overview } from './types';
import Header from './components/header/header';
import IDCard from './components/idcard/idcard';
import Nav from './components/nav/nav';
import Account from './components/account/account';
import Profile from './components/profile/profile';
import Content from './components/content/content';
import { tabFromPath, type Tab } from './routing';
import { translateUI, useTranslateUI } from '@hub/locale';
import { useTranslateUI as useTranslateMainUI } from '@main/locale';

function useAccount() {
    const [overview, setOverview] = useState<Overview | null>(null);
    const [revision, setRevision] = useState(0);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pending = useRef(false);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        void getOverview(controller.signal)
            .then((result) => {
                if (!controller.signal.aborted) setOverview(result);
            })
            .catch((cause: unknown) => {
                if (controller.signal.aborted) return;
                if (isUnauthorized(cause)) {
                    window.location.assign('/');
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

    const refresh = () => setRevision((value) => value + 1);

    const run = async (action: () => Promise<unknown>) => {
        if (pending.current) return;
        pending.current = true;
        setActing(true);
        setError(null);
        try {
            await action();
            refresh();
        } catch (cause) {
            if (isUnauthorized(cause)) window.location.assign('/');
            else
                setError(
                    cause instanceof Error
                        ? cause.message
                        : translateUI('userHub.actionError'),
                );
        } finally {
            pending.current = false;
            setActing(false);
        }
    };

    return {
        overview,
        revision,
        loading,
        error,
        busy: loading || acting,
        refresh,
        run,
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
    const { overview, revision, loading, error, busy, refresh, run } =
        useAccount();

    useEffect(() => {
        if (pageTitle) document.title = pageTitle;
    }, [pageTitle]);

    useEffect(() => {
        const onPopState = () => setActive(tabFromPath());
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
                        {overview &&
                            (active === 'contributions' ? (
                                <Content
                                    revision={revision}
                                    counts={overview.contributions}
                                />
                            ) : active === 'profile' ? (
                                <Profile
                                    user={overview.user}
                                    onSaved={refresh}
                                />
                            ) : (
                                <Account
                                    overview={overview}
                                    busy={busy}
                                    onLink={(provider) =>
                                        void run(() => linkSocial(provider))
                                    }
                                    onUnlink={(provider) =>
                                        void run(() => unlinkAccount(provider))
                                    }
                                    onUnlinkEndfield={() =>
                                        void run(unlinkEndfieldBinding)
                                    }
                                />
                            ))}
                    </main>
                </div>
            </div>
        </div>
    );
}

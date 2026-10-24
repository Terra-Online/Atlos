import { EntryButton } from '@/component/button/EntryButton';
import {
    Component,
    useEffect,
    useState,
    type ReactNode,
    type ComponentProps,
} from 'react';
import { useTranslateUI } from '@hub/locale';
import type AuthGate from './authGate';
import { getAuthGate, loadAuthGate } from './authEntry';

class LoadBoundary extends Component<
    { children: ReactNode; fallback: ReactNode },
    { failed: boolean }
> {
    override state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    override render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

export default function AuthLoader(props: ComponentProps<typeof AuthGate>) {
    const t = useTranslateUI();
    const [Gate, setGate] = useState(getAuthGate);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let active = true;
        // Reuse the download started by the 401 handler, including on remount.
        // Explicit state keeps the modal outside Suspense reveal throttling.
        void loadAuthGate()
            .then((component) => {
                if (active) setGate(() => component);
            })
            .catch(() => {
                if (active) setFailed(true);
            });
        return () => {
            active = false;
        };
    }, []);
    const fallback = (
        <div role='alert'>
            <p>{t('userHub.loadError')}</p>
            <EntryButton
                label={t('userHub.retry')}
                onClick={() => window.location.reload()}
            />
        </div>
    );
    if (failed) return fallback;
    return (
        <LoadBoundary fallback={fallback}>
            {Gate ? (
                <Gate {...props} />
            ) : (
                <p role='status'>{t('common.loading')}</p>
            )}
        </LoadBoundary>
    );
}

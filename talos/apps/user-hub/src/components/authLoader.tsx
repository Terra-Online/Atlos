import {
    Component,
    useEffect,
    useState,
    type ReactNode,
    type ComponentProps,
} from 'react';
import { AccessButton } from '@main/component/login/access/button';
import { useTranslateUI } from '@hub/locale';
import type AuthGate from './authGate';

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
    const [Gate, setGate] = useState<typeof AuthGate | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let active = true;
        // This starts only after a 401. Explicit loading avoids Suspense's reveal
        // delay on the auth controller's first session-driven modal update.
        void import('./authGate')
            .then((module) => {
                if (active) setGate(() => module.default);
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
            <AccessButton
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

import { EntryButton } from '@/component/button/EntryButton';
import {
    Component,
    type ReactNode,
    type ComponentProps,
} from 'react';
import { useTranslateUI } from '@hub/locale';
import type AuthGate from './authGate';
import { getAuthGate, loadAuthGate } from './authEntry';
import { useRetryImport } from '@main/lib/dom/useRetryImport';

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
    const loaded = useRetryImport(loadAuthGate, true);
    const Gate = loaded ?? getAuthGate();
    const fallback = (
        <div role='alert'>
            <p>{t('userHub.loadError')}</p>
            <EntryButton
                label={t('userHub.retry')}
                onClick={() => window.location.reload()}
            />
        </div>
    );
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

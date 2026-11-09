import React, { useEffect, useRef, useState } from 'react';
import { useRetryImport } from '@/lib/dom/useRetryImport';
import ErrorBoundary from '@/component/shared/ErrorBoundary';
import Modal from '@/component/modal/modal';
import { useTranslateUI } from '@/locale';
import { useDevice } from '@/platform/device';
import {
    ENDFIELD_BINDING_REQUEST_EVENT,
    type EndfieldBindingRequestDetail,
} from '@/store/locator';

const loadBinding = () => import('@/pages/locator/LocationBinding');

const EndfieldBindingHost: React.FC = () => {
    const { isMobile } = useDevice();
    const t = useTranslateUI();
    const [open, setOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const LocationBinding = useRetryImport(loadBinding, open)?.default;
    const requestRef = useRef<EndfieldBindingRequestDetail>({});

    useEffect(() => {
        const handleRequest = (event: Event) => {
            requestRef.current = (event as CustomEvent<EndfieldBindingRequestDetail>).detail ?? {};
            setMounted(true);
            setOpen(true);
        };

        window.addEventListener(ENDFIELD_BINDING_REQUEST_EVENT, handleRequest);
        return () => {
            window.removeEventListener(ENDFIELD_BINDING_REQUEST_EVENT, handleRequest);
        };
    }, []);

    if (!mounted) return null;
    if (!LocationBinding) return open ? (
        <Modal open size={isMobile ? 'full' : 'l'} onChange={setOpen}>
            <p role="status">{t('common.loading')}</p>
        </Modal>
    ) : null;

    return (
        <ErrorBoundary resetKeys={[open]}>
            <LocationBinding
                open={open}
                modalSize={isMobile ? 'full' : 'l'}
                enableLocatorOnBound={requestRef.current.enableLocator ?? false}
                onClose={() => setOpen(false)}
                onBound={() => {
                    setOpen(false);
                    void requestRef.current.onBound?.();
                }}
            />
        </ErrorBoundary>
    );
};

export default React.memo(EndfieldBindingHost);

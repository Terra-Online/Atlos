import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useDevice } from '@/platform/device';
import {
    ENDFIELD_BINDING_REQUEST_EVENT,
    type EndfieldBindingRequestDetail,
} from './state';

const LocationBinding = lazy(() => import('./LocationBinding'));

const EndfieldBindingHost: React.FC = () => {
    const { isMobile } = useDevice();
    const [open, setOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
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

    return (
        <Suspense fallback={null}>
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
        </Suspense>
    );
};

export default React.memo(EndfieldBindingHost);

import { useLayerStore } from '@/store/layer';
import { getCurrentLocale } from '@/locale';
import { previewLink, viewerUrl } from './client';
import { record, VERSION } from './types';

const session = (() => {
    try {
        const value =
            sessionStorage.getItem('oem-world-session') || crypto.randomUUID();
        sessionStorage.setItem('oem-world-session', value);
        return value;
    } catch {
        return crypto.randomUUID();
    }
})();
let preview: Window | null = null;
let ready = false;
let nonce = '';
let pending: {
    type: 'open-point';
    point: string;
} | null = null;
const expectedOrigin = new URL(viewerUrl, location.href).origin;

const preferences = () => ({
    satellite: useLayerStore.getState().satellite,
    locale: getCurrentLocale(),
});

const flush = () => {
    if (!preview || preview.closed || !ready || !pending) return;
    preview.postMessage(
        {
            version: VERSION,
            session,
            nonce,
            preferences: preferences(),
            ...pending,
        },
        expectedOrigin,
    );
    pending = null;
};
const receive = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (
        event.origin !== expectedOrigin ||
        event.source !== preview ||
        !record(data) ||
        data.version !== VERSION
    )
        return;
    if (
        data.type === 'world-ready' &&
        typeof data.nonce === 'string' &&
        data.nonce
    ) {
        ready = false;
        nonce = data.nonce;
        preview?.postMessage(
            {
                version: VERSION,
                type: 'connect',
                session,
                nonce,
                preferences: preferences(),
            },
            expectedOrigin,
        );
    } else if (
        data.type === 'connected' &&
        data.session === session &&
        data.nonce === nonce
    ) {
        ready = true;
        flush();
    }
};
window.addEventListener('message', receive);
if (import.meta.hot)
    import.meta.hot.dispose(() =>
        window.removeEventListener('message', receive),
    );

/** Open synchronously from the user's click so loading data never consumes popup activation. */
export const openPreview = (point: string): boolean => {
    pending = { type: 'open-point', point };
    if (!preview || preview.closed) {
        ready = false;
        preview = window.open(previewLink(point), `oem-world-${session}`);
    } else {
        preview.focus();
        flush();
    }
    return preview !== null;
};

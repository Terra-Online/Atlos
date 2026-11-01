import { previewLink, viewerUrl } from './client';
import { record, VERSION } from './types';

const session = (() => {
    try {
        const value =
            sessionStorage.getItem('oem-noclip-session') || crypto.randomUUID();
        sessionStorage.setItem('oem-noclip-session', value);
        return value;
    } catch {
        return crypto.randomUUID();
    }
})();
let preview: Window | null = null;
let ready = false;
let pending: {
    type: 'open-point';
    point: string;
} | null = null;
const expectedOrigin = new URL(viewerUrl, location.href).origin;

const flush = () => {
    if (!preview || preview.closed || !ready || !pending) return;
    preview.postMessage(
        { version: VERSION, session, ...pending },
        expectedOrigin,
    );
    pending = null;
};
window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (
        event.origin !== expectedOrigin ||
        event.source !== preview ||
        !record(data) ||
        data.version !== VERSION ||
        data.session !== session
    )
        return;
    if (data.type === 'ready') {
        ready = true;
        flush();
    }
});

/** Open synchronously from the user's click so loading data never consumes popup activation. */
export const openPreview = (point: string, release: string): boolean => {
    pending = { type: 'open-point', point };
    if (!preview || preview.closed) {
        ready = false;
        preview = window.open(
            previewLink(point, release, session),
            `oem-noclip-${session}`,
        );
    } else {
        preview.focus();
        flush();
    }
    return preview !== null;
};

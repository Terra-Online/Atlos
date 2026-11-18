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
type PreviewMode = 'position' | 'route';
type Channel = {
    popup: Window | null;
    ready: boolean;
    nonce: string;
    pending: string | null;
};
const createChannel = (): Channel => ({
    popup: null,
    ready: false,
    nonce: '',
    pending: null,
});
const channels = { position: createChannel(), route: createChannel() };
const expectedOrigin = new URL(viewerUrl, location.href).origin;

const preferences = () => ({
    satellite: useLayerStore.getState().satellite,
    locale: getCurrentLocale(),
});

const flush = (channel: Channel) => {
    const { popup, ready, nonce, pending } = channel;
    if (!popup || popup.closed || !ready || !pending) return;
    popup.postMessage(
        {
            version: VERSION,
            session,
            nonce,
            preferences: preferences(),
            type: 'open-point',
            point: pending,
        },
        expectedOrigin,
    );
    channel.pending = null;
};
const receive = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (
        event.origin !== expectedOrigin ||
        !event.source ||
        !record(data) ||
        data.version !== VERSION
    )
        return;
    const channel = Object.values(channels).find(
        ({ popup }) => popup === event.source,
    );
    if (!channel) return;
    if (
        data.type === 'world-ready' &&
        typeof data.nonce === 'string' &&
        data.nonce
    ) {
        channel.ready = false;
        channel.nonce = data.nonce;
        channel.popup?.postMessage(
            {
                version: VERSION,
                type: 'connect',
                session,
                nonce: channel.nonce,
                preferences: preferences(),
            },
            expectedOrigin,
        );
    } else if (
        data.type === 'connected' &&
        data.session === session &&
        data.nonce === channel.nonce
    ) {
        channel.ready = true;
        flush(channel);
    }
};
window.addEventListener('message', receive);
if (import.meta.hot)
    import.meta.hot.dispose(() =>
        window.removeEventListener('message', receive),
    );

/** Open synchronously from the user's click so loading data never consumes popup activation. */
export const openPreview = (
    point: string,
    mode: PreviewMode = 'position',
): boolean => {
    const channel = channels[mode];
    channel.pending = point;
    if (!channel.popup || channel.popup.closed) {
        channel.ready = false;
        channel.nonce = '';
        channel.popup = window.open(
            previewLink(
                point,
                mode === 'route' ? { planRoute: 'nearest' } : undefined,
            ),
            mode === 'route'
                ? `oem-world-route-${session}`
                : `oem-world-${session}`,
        );
    } else {
        channel.popup.focus();
        flush(channel);
    }
    return channel.popup !== null;
};

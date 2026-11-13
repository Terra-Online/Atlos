import { record, VERSION, isMapOrigin } from '@/services/noclip/types';

/** Bind only to the actual opener after a nonce challenge; shared links work without an opener. */
export function connectWorld(
    openPoint: (id: string) => void,
    preferences: (value: { satellite: boolean; locale: string }) => void,
) {
    const nonce = crypto.randomUUID();
    // lib.dom types opener as any, although browsers expose a WindowProxy or null.
    const opener = window.opener as Window | null;
    let bound: { origin: string; session: string } | null = null;
    const send = (type: string, payload: object = {}) => {
        if (bound)
            opener?.postMessage(
                {
                    version: VERSION,
                    session: bound.session,
                    nonce,
                    type,
                    ...payload,
                },
                bound.origin,
            );
    };
    const applyPreferences = (value: unknown) => {
        if (
            record(value) &&
            typeof value.satellite === 'boolean' &&
            typeof value.locale === 'string'
        )
            preferences({ satellite: value.satellite, locale: value.locale });
    };
    const receive = (event: MessageEvent<unknown>) => {
        const d = event.data;
        if (
            !opener ||
            event.source !== opener ||
            !isMapOrigin(event.origin) ||
            !record(d) ||
            d.version !== VERSION
        )
            return;
        if (
            d.type === 'connect' &&
            d.nonce === nonce &&
            typeof d.session === 'string' &&
            d.session.length > 0
        ) {
            if (bound && bound.origin !== event.origin) return;
            bound = { origin: event.origin, session: d.session };
            applyPreferences(d.preferences);
            send('connected');
        } else if (
            bound &&
            event.origin === bound.origin &&
            d.session === bound.session &&
            d.nonce === nonce &&
            d.type === 'open-point' &&
            typeof d.point === 'string'
        ) {
            applyPreferences(d.preferences);
            openPoint(d.point);
        }
    };
    window.addEventListener('message', receive);
    // No target data is sent until the opener proves its origin and the challenge.
    opener?.postMessage({ version: VERSION, type: 'world-ready', nonce }, '*');
    return {
        send,
        close: () => window.removeEventListener('message', receive),
    };
}

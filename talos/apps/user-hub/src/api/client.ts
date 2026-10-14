import { pickSessionUser, updateProfileNickname } from '@main/services/auth';
import { getAuthBase } from '@main/services/http/authRuntime';
import { requestJson, HttpRequestError } from '@main/services/http/request';
import type { Contribution, Overview, Provider } from '../types';
import { useAuthStore } from '@main/store/auth';

const authBase = getAuthBase();
const meBase = `${authBase}/me/v1`;
const authApiBase = `${authBase}/auth/v1`;

const resolvePreview = (item: Contribution): Contribution => ({
    ...item,
    previewUrl: item.previewUrl
        ? new URL(item.previewUrl, `${authBase}/`).href
        : null,
});

export type ContributionsPage = {
    items: Contribution[];
    nextCursor: string | null;
};

type Read<T> = { expiresAt: number; value: Promise<T> };
const overviews = new Map<string, Read<Overview>>();
const pages = new Map<string, Read<ContributionsPage>>();

export const clearReadCache = () => {
    overviews.clear();
    pages.clear();
};
useAuthStore.subscribe((state, previous) => {
    if (state.sessionUser?.uid !== previous.sessionUser?.uid) clearReadCache();
});

function read<T>(
    cache: Map<string, Read<T>>,
    key: string,
    load: () => Promise<T>,
    signal?: AbortSignal,
): Promise<T> {
    signal?.throwIfAborted();
    let entry = cache.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
        if (cache.size >= 32) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
        }
        entry = { expiresAt: Date.now() + 15_000, value: load() };
        cache.set(key, entry);
        const current = entry;
        void current.value.catch(() => {
            if (cache.get(key) === current) cache.delete(key);
        });
    }
    // Cancellation belongs to the consumer: StrictMode/tab changes must not
    // abort a request another mounted consumer is already waiting for.
    return entry.value.then((result) => {
        signal?.throwIfAborted();
        return result;
    });
}

export const getOverview = (signal?: AbortSignal): Promise<Overview> => {
    const uid = useAuthStore.getState().sessionUser?.uid ?? '';
    return read(
        overviews,
        uid,
        async () => {
            // Profile data must reflect a just-saved avatar; D1 counts have their
            // own short server cache, while remounts share this memory cache.
            const result = await requestJson<Overview>(meBase, '/overview', {
                cache: 'no-cache',
            });
            return { ...result, user: pickSessionUser(result) ?? result.user };
        },
        signal,
    );
};

export const getContributions = (
    kind?: 'image' | 'comment',
    cursor?: string,
    signal?: AbortSignal,
): Promise<ContributionsPage> => {
    const query = new URLSearchParams({ limit: '20' });
    if (kind) query.set('kind', kind);
    if (cursor) query.set('cursor', cursor);
    const uid = useAuthStore.getState().sessionUser?.uid ?? '';
    return read(
        pages,
        JSON.stringify([uid, query.toString()]),
        async () => {
            const page = await requestJson<ContributionsPage>(
                meBase,
                `/contributions?${query.toString()}`,
            );
            return { ...page, items: page.items.map(resolvePreview) };
        },
        signal,
    );
};

export const unlinkAccount = (provider: Provider): Promise<unknown> =>
    requestJson(authApiBase, '/unlink-account', {
        method: 'POST',
        body: JSON.stringify({ provider }),
    });

export const linkSocial = async (
    provider: Exclude<Provider, 'email'>,
): Promise<void> => {
    const callbackURL = new URL('/me/account', window.location.origin).href;
    const result = await requestJson<{ url?: string }>(
        authApiBase,
        '/link-social',
        {
            method: 'POST',
            body: JSON.stringify({
                provider,
                disableRedirect: true,
                callbackURL,
                errorCallbackURL: callbackURL,
            }),
        },
    );
    if (!result.url)
        throw new Error('The server did not return an account linking URL.');
    window.location.assign(result.url);
};

export const unlinkEndfieldBinding = (): Promise<unknown> =>
    requestJson(`${authBase}/binding/v1/endfield`, '/unlink', {
        method: 'POST',
        body: '{}',
    });

export const saveProfile = async (
    ...args: Parameters<typeof updateProfileNickname>
) => {
    const user = await updateProfileNickname(...args);
    overviews.clear();
    return user;
};

export const isUnauthorized = (error: unknown): boolean =>
    error instanceof HttpRequestError && error.status === 401;

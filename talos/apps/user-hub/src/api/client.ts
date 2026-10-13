import { pickSessionUser, updateProfileNickname } from '@main/services/auth';
import { getAuthBase } from '@main/services/http/authRuntime';
import { requestJson, HttpRequestError } from '@main/services/http/request';
import type { Contribution, Overview, Provider } from '../types';
import { pathForTab } from '../routing';

const authBase = getAuthBase();
const meBase = `${authBase}/me/v1`;
const authApiBase = `${authBase}/auth/v1`;

export type ContributionsPage = {
    items: Contribution[];
    nextCursor: string | null;
};

export const getOverview = async (signal?: AbortSignal): Promise<Overview> => {
    const result = await requestJson<Overview>(meBase, '/overview', { signal });
    return { ...result, user: pickSessionUser(result) ?? result.user };
};

export const getContributions = (
    kind?: 'image' | 'comment',
    cursor?: string,
    signal?: AbortSignal,
): Promise<ContributionsPage> => {
    const query = new URLSearchParams({ limit: '20' });
    if (kind) query.set('kind', kind);
    if (cursor) query.set('cursor', cursor);
    return requestJson<ContributionsPage>(
        meBase,
        `/contributions?${query.toString()}`,
        { signal },
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
    const callbackURL = new URL(pathForTab('account'), window.location.origin)
        .href;
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

export const saveProfile = updateProfileNickname;

export const isUnauthorized = (error: unknown): boolean =>
    error instanceof HttpRequestError && error.status === 401;

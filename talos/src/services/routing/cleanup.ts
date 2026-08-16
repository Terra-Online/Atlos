import { AUTH_URL_PARAM_WHITELIST, MAP_URL_PARAMS } from './protocol';
import { stripPathPointToken } from './path';
import type { UrlLocationLike } from './parse';

export const buildCleanUrl = (
    location: UrlLocationLike,
    pathPointToken: string | null,
): string => {
    const params = new URLSearchParams(location.search);
    MAP_URL_PARAMS.forEach((param) => params.delete(param));

    const preservedParams = new URLSearchParams();
    params.forEach((value, key) => {
        if (AUTH_URL_PARAM_WHITELIST.has(key)) preservedParams.append(key, value);
    });

    const pathname = pathPointToken
        ? stripPathPointToken(location.pathname)
        : location.pathname;
    const queryString = preservedParams.toString();
    return queryString ? `${pathname}?${queryString}` : pathname;
};

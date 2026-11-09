export type LocatorAccountMode = 'skport' | 'skland';

export const inferLocatorAccountModeFromBaseUrl = (baseUrl?: string): LocatorAccountMode =>
    baseUrl === 'skland' ? 'skland' : 'skport';

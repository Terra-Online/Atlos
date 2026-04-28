import type { EndfieldClientOptions } from '@/utils/endfield/client';

export type LocatorAccountMode = 'skport' | 'skland';

const IS_DEV = import.meta.env.DEV;

const SKPORT_BASE_URL = IS_DEV ? '/proxy/skport-api' : 'https://zonai.skport.com';
const SKPORT_AUTH_BASE_URL = IS_DEV ? '/proxy/skport-auth' : 'https://as.gryphline.com';
const SKLAND_BASE_URL = IS_DEV ? '/proxy/skland-api' : 'https://zonai.skland.com';
const SKLAND_AUTH_BASE_URL = IS_DEV ? '/proxy/skland-auth' : 'https://as.hypergryph.com';

export const resolveEndfieldApiHosts = (mode: LocatorAccountMode): EndfieldClientOptions =>
    mode === 'skland'
        ? { baseUrl: SKLAND_BASE_URL, authBaseUrl: SKLAND_AUTH_BASE_URL }
        : { baseUrl: SKPORT_BASE_URL, authBaseUrl: SKPORT_AUTH_BASE_URL };

export const inferLocatorAccountModeFromBaseUrl = (baseUrl?: string): LocatorAccountMode =>
    baseUrl?.includes('skland.com') ? 'skland' : 'skport';

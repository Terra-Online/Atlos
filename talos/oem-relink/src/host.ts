export type RedirectMode = 'geo' | 'org' | 'cn';

export type HostRule = {
    mode: RedirectMode;
    description: string;
    preserveSubdomain?: boolean;
};

export type HostDecision = {
    allowed: boolean;
    hostname: string;
    key: string;
    rule?: HostRule;
    reason: string;
};

export type CountrySource = {
    byHeader?: string;
    byCfCountry?: string;
};

export const TARGET_CN_ORIGIN = 'https://opendfieldmap.cn';
export const TARGET_ORG_ORIGIN = 'https://opendfieldmap.org';
export const TARGET_CN_CDN_ORIGIN = 'https://cdn.opendfieldmap.cn';
export const TARGET_ORG_CDN_ORIGIN = 'https://cdn.opendfieldmap.org';
export const CDN_PREFIXES = {
    cn: {
        prod: '/_dev/endfield/atlos',
        beta: '/_beta/endfield/atlos',
    },
    org: {
        prod: '/_dev/endfield/atlos',
        beta: '/_beta/endfield/atlos',
    },
} as const;

const ROOT_SHORT_DOMAIN = 'oem.re';

// Whitelist table: add new subdomains here only.
// '@' means the root short domain itself (oem.re).
const SUBDOMAIN_WHITELIST: Record<string, HostRule> = {
    '@': {
        mode: 'geo',
        description: 'root short domain',
    },
    beta: {
        mode: 'geo',
        description: 'beta environment uses geo redirect',
        preserveSubdomain: true,
    },
    blog: {
        mode: 'org',
        description: 'blog always redirects to org',
        preserveSubdomain: true,
    },
};

const normalizeHostname = (hostname: string): string =>
    hostname.trim().toLowerCase().replace(/\.+$/, '');

export const resolveHostDecision = (hostname: string): HostDecision => {
    const normalizedHost = normalizeHostname(hostname);
    const rootSuffix = `.${ROOT_SHORT_DOMAIN}`;

    let key = '';
    if (normalizedHost === ROOT_SHORT_DOMAIN) {
        key = '@';
    } else if (normalizedHost.endsWith(rootSuffix)) {
        key = normalizedHost.slice(0, -rootSuffix.length);
    } else {
        return {
            allowed: false,
            hostname: normalizedHost,
            key: '',
            reason: 'host not under short domain',
        };
    }

    const rule = SUBDOMAIN_WHITELIST[key];
    if (!rule) {
        return {
            allowed: false,
            hostname: normalizedHost,
            key,
            reason: 'subdomain not whitelisted',
        };
    }

    return {
        allowed: true,
        hostname: normalizedHost,
        key,
        rule,
        reason: 'whitelisted',
    };
};

export const resolveTargetOrigin = (
    country: CountrySource,
    mode: RedirectMode,
    hostDecision: HostDecision,
): { origin: string; reason: string } => {
    let baseOrigin = TARGET_ORG_ORIGIN;
    let reason = 'mode=geo; default non-CN';

    if (mode === 'org') {
        baseOrigin = TARGET_ORG_ORIGIN;
        reason = 'mode=org';
    } else if (mode === 'cn') {
        baseOrigin = TARGET_CN_ORIGIN;
        reason = 'mode=cn';
    } else if (country.byHeader === 'CN') {
        baseOrigin = TARGET_CN_ORIGIN;
        reason = 'mode=geo; cf-ipcountry=CN';
    } else if (country.byCfCountry === 'CN') {
        baseOrigin = TARGET_CN_ORIGIN;
        reason = 'mode=geo; request.cf.country=CN';
    }

    const shouldPreserveSubdomain =
        hostDecision.allowed &&
        hostDecision.rule?.preserveSubdomain === true &&
        hostDecision.key !== '@';

    if (!shouldPreserveSubdomain) {
        return { origin: baseOrigin, reason };
    }

    const targetUrl = new URL(baseOrigin);
    targetUrl.hostname = `${hostDecision.key}.${targetUrl.hostname}`;
    return {
        origin: targetUrl.origin,
        reason: `${reason}; preserve-subdomain=${hostDecision.key}`,
    };
};

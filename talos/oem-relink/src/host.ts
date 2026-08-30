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

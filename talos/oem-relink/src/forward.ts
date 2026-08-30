import {
    SEO_POINT_PREVIEWS,
    type SeoPointPreview,
    type SeoPointPreviewLocale,
} from './seo-preview.generated';
import {
    resolveHostDecision,
    type HostDecision,
    type RedirectMode,
} from './host';
import { WORKER_VERSION } from './version';

const TARGET_CN_ORIGIN = 'https://opendfieldmap.cn';
const TARGET_ORG_ORIGIN = 'https://opendfieldmap.org';
const TARGET_CN_CDN_ORIGIN = 'https://cdn.opendfieldmap.cn';
const TARGET_ORG_CDN_ORIGIN = 'https://cdn.opendfieldmap.org';
const CDN_PREFIXES = {
    cn: {
        prod: '/_dev/endfield/atlos',
        beta: '/_beta/endfield/atlos',
    },
    org: {
        prod: '/_dev/endfield/atlos',
        beta: '/_beta/endfield/atlos',
    },
} as const;
const PREVIEW_TITLE = 'Open Endfield Map';
const PREVIEW_DESCRIPTION =
    'Open Endfield Map is an open-source interactive map for Arknights: Endfield.';
const SOCIAL_PREVIEW_BOT_KEYWORDS: string[] = [
    'telegrambot',
    'discordbot',
    'facebookexternalhit',
    'facebot',
    'qzone',
    'qq/',
];

type CountrySource = {
    byHeader?: string;
    byCfCountry?: string;
};

type ResolvedSeoPointPreview = SeoPointPreview & {
    image: string;
    url: string;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === 'object' && value !== null;

const getRequestCf = (request: Request): UnknownRecord => {
    const cf = (request as Request & { cf?: unknown }).cf;
    return isRecord(cf) ? cf : {};
};

const getStringValue = (
    obj: UnknownRecord,
    key: string,
): string | undefined => {
    const value = obj[key];
    return typeof value === 'string' ? value : undefined;
};

const getNumberValue = (
    obj: UnknownRecord,
    key: string,
): number | undefined => {
    const value = obj[key];
    return typeof value === 'number' ? value : undefined;
};

const getBooleanValue = (
    obj: UnknownRecord,
    key: string,
): boolean | undefined => {
    const value = obj[key];
    return typeof value === 'boolean' ? value : undefined;
};

const hasValue = (value: unknown): boolean => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (isRecord(value)) return Object.keys(value).length > 0;
    return true;
};

const setIfHasValue = (
    target: UnknownRecord,
    key: string,
    value: unknown,
): void => {
    if (hasValue(value)) {
        target[key] = value;
    }
};

const parseJsonHeader = (request: Request, key: string): unknown => {
    const raw = request.headers.get(key);
    if (!raw) return undefined;
    if (raw[0] !== '{' && raw[0] !== '[') {
        return raw;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
};

const collectDebugProfile = (request: Request): UnknownRecord => {
    const cf = getRequestCf(request);
    const botManagement = isRecord(cf.botManagement)
        ? cf.botManagement
        : undefined;

    const profile: UnknownRecord = {};
    setIfHasValue(
        profile,
        'availableCfKeys',
        Object.keys(cf)
            .filter((key) => !key.toLowerCase().startsWith('tls'))
            .sort(),
    );

    const geo: UnknownRecord = {};
    setIfHasValue(geo, 'country', getStringValue(cf, 'country'));
    setIfHasValue(geo, 'continent', getStringValue(cf, 'continent'));
    setIfHasValue(geo, 'city', getStringValue(cf, 'city'));
    setIfHasValue(geo, 'region', getStringValue(cf, 'region'));
    setIfHasValue(geo, 'regionCode', getStringValue(cf, 'regionCode'));
    setIfHasValue(geo, 'postalCode', getStringValue(cf, 'postalCode'));
    setIfHasValue(geo, 'metroCode', getStringValue(cf, 'metroCode'));
    setIfHasValue(geo, 'latitude', getStringValue(cf, 'latitude'));
    setIfHasValue(geo, 'longitude', getStringValue(cf, 'longitude'));
    setIfHasValue(geo, 'timezone', getStringValue(cf, 'timezone'));
    setIfHasValue(
        geo,
        'isEUCountry',
        getBooleanValue(cf, 'isEUCountry') ?? getStringValue(cf, 'isEUCountry'),
    );
    setIfHasValue(profile, 'geo', geo);

    const network: UnknownRecord = {};
    setIfHasValue(
        network,
        'asn',
        getNumberValue(cf, 'asn') ?? getStringValue(cf, 'asn'),
    );
    setIfHasValue(
        network,
        'asOrganization',
        getStringValue(cf, 'asOrganization'),
    );
    setIfHasValue(network, 'colo', getStringValue(cf, 'colo'));
    setIfHasValue(network, 'httpProtocol', getStringValue(cf, 'httpProtocol'));
    setIfHasValue(network, 'clientTcpRtt', getNumberValue(cf, 'clientTcpRtt'));
    setIfHasValue(
        network,
        'clientQuicRtt',
        getNumberValue(cf, 'clientQuicRtt'),
    );
    setIfHasValue(
        network,
        'requestPriority',
        getStringValue(cf, 'requestPriority'),
    );
    setIfHasValue(
        network,
        'edgeRequestKeepAliveStatus',
        getNumberValue(cf, 'edgeRequestKeepAliveStatus'),
    );
    setIfHasValue(profile, 'network', network);

    const bot: UnknownRecord = {};
    setIfHasValue(
        bot,
        'verifiedBotCategory',
        getStringValue(cf, 'verifiedBotCategory'),
    );
    setIfHasValue(bot, 'botManagement', botManagement);
    setIfHasValue(profile, 'bot', bot);

    const clientHints: UnknownRecord = {};
    setIfHasValue(clientHints, 'secChUa', request.headers.get('sec-ch-ua'));
    setIfHasValue(
        clientHints,
        'secChUaMobile',
        request.headers.get('sec-ch-ua-mobile'),
    );
    setIfHasValue(
        clientHints,
        'secChUaPlatform',
        request.headers.get('sec-ch-ua-platform'),
    );
    setIfHasValue(
        clientHints,
        'secChUaPlatformVersion',
        request.headers.get('sec-ch-ua-platform-version'),
    );
    setIfHasValue(
        clientHints,
        'secChUaArch',
        request.headers.get('sec-ch-ua-arch'),
    );
    setIfHasValue(
        clientHints,
        'secChUaModel',
        request.headers.get('sec-ch-ua-model'),
    );
    setIfHasValue(
        clientHints,
        'secChUaFullVersion',
        request.headers.get('sec-ch-ua-full-version'),
    );
    setIfHasValue(
        clientHints,
        'secChUaFullVersionList',
        request.headers.get('sec-ch-ua-full-version-list'),
    );

    const networkHints: UnknownRecord = {};
    setIfHasValue(networkHints, 'downlink', request.headers.get('downlink'));
    setIfHasValue(networkHints, 'ect', request.headers.get('ect'));
    setIfHasValue(networkHints, 'rtt', request.headers.get('rtt'));
    setIfHasValue(networkHints, 'saveData', request.headers.get('save-data'));

    const headers: UnknownRecord = {};
    setIfHasValue(headers, 'cfIpCountry', request.headers.get('cf-ipcountry'));
    setIfHasValue(
        headers,
        'cfConnectingIp',
        request.headers.get('cf-connecting-ip'),
    );
    setIfHasValue(headers, 'cfRay', request.headers.get('cf-ray'));
    setIfHasValue(headers, 'cfVisitor', parseJsonHeader(request, 'cf-visitor'));
    setIfHasValue(headers, 'userAgent', request.headers.get('user-agent'));
    setIfHasValue(
        headers,
        'acceptLanguage',
        request.headers.get('accept-language'),
    );
    setIfHasValue(headers, 'referer', request.headers.get('referer'));
    setIfHasValue(headers, 'host', request.headers.get('host'));
    setIfHasValue(headers, 'clientHints', clientHints);
    setIfHasValue(headers, 'networkHints', networkHints);
    setIfHasValue(profile, 'headers', headers);

    return profile;
};

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const shouldServeSocialPreview = (
    userAgent: string,
    forcePreview: boolean,
): boolean => {
    if (forcePreview) {
        return true;
    }
    const normalizedUserAgent = userAgent.toLowerCase();
    return SOCIAL_PREVIEW_BOT_KEYWORDS.some((keyword) =>
        normalizedUserAgent.includes(keyword),
    );
};

const buildPreviewImageUrl = (targetOrigin: string): string =>
    new URL('/og_preview.jpg', targetOrigin).toString();

const POINT_TOKEN_PATTERN = /^[0-9a-zA-Z]{7}$/;
const INTEL_IMPORT_PREFIXES = ['OEA-0-', 'MAE-0-'] as const;
const escapeRegex = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const INTEL_IMPORT_PREFIX_PATTERN =
    INTEL_IMPORT_PREFIXES.map(escapeRegex).join('|');
const INTEL_IMPORT_PATH_PATTERN = new RegExp(
    `^/i/((?:${INTEL_IMPORT_PREFIX_PATTERN})[A-Za-z0-9_-]+)(?:/_debug)?/?$`,
);
const INTEL_IMPORT_DEBUG_PATH_PATTERN = new RegExp(
    `^/i/(?:${INTEL_IMPORT_PREFIX_PATTERN})[A-Za-z0-9_-]+/_debug/?$`,
);

const getIntelImportPrefix = (
    token: string,
): (typeof INTEL_IMPORT_PREFIXES)[number] | null =>
    INTEL_IMPORT_PREFIXES.find((prefix) => token.startsWith(prefix)) ?? null;

const getPointPreviewToken = (requestUrl: URL): string | null => {
    const queryToken = requestUrl.searchParams.get('x')?.trim();
    if (queryToken && POINT_TOKEN_PATTERN.test(queryToken)) return queryToken;
    const pathToken = requestUrl.pathname.replace(/^\/+|\/+$/g, '');
    if (pathToken && POINT_TOKEN_PATTERN.test(pathToken)) return pathToken;
    return null;
};

const getIntelImportToken = (requestUrl: URL): string | null => {
    const pathMatch = requestUrl.pathname.match(INTEL_IMPORT_PATH_PATTERN);
    if (pathMatch) return pathMatch[1];

    if (requestUrl.pathname !== '/i' && requestUrl.pathname !== '/i/') {
        return null;
    }

    const queryToken = requestUrl.searchParams.get('import')?.trim();
    return queryToken && getIntelImportPrefix(queryToken) ? queryToken : null;
};

const isIntelImportDebugRequest = (requestUrl: URL): boolean =>
    INTEL_IMPORT_DEBUG_PATH_PATTERN.test(requestUrl.pathname);

const decodeIntelImportDebugPayload = async (
    token: string,
): Promise<unknown> => {
    const prefix = getIntelImportPrefix(token);
    if (!prefix) {
        throw new Error('The import token has an invalid prefix.');
    }

    const encoded = token.slice(prefix.length);
    if (
        !encoded ||
        encoded.includes('=') ||
        !/^[A-Za-z0-9_-]+$/.test(encoded)
    ) {
        throw new Error('The import token is not valid base64url.');
    }

    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const compressed = Uint8Array.from(atob(padded), (character) =>
        character.charCodeAt(0),
    );
    const compressedStream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(compressed);
            controller.close();
        },
    });
    const stream = compressedStream.pipeThrough(
        new DecompressionStream('gzip'),
    );
    const json = await new Response(stream).text();
    return JSON.parse(json) as unknown;
};

const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body, null, 2), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
        },
    });

const resolveTargetKind = (targetOrigin: string): 'cn' | 'org' => {
    const targetUrl = new URL(targetOrigin);
    return targetUrl.hostname.endsWith('opendfieldmap.cn') ? 'cn' : 'org';
};

const resolveTargetChannel = (targetOrigin: string): 'beta' | 'prod' => {
    const targetUrl = new URL(targetOrigin);
    return targetUrl.hostname.startsWith('beta.') ? 'beta' : 'prod';
};

const resolvePreviewLocale = (
    targetKind: 'cn' | 'org',
): SeoPointPreviewLocale => (targetKind === 'cn' ? 'zh' : 'en');

const buildPointCanonicalUrl = (targetOrigin: string, token: string): string =>
    new URL(`/${encodeURIComponent(token)}/`, targetOrigin).toString();

const buildPointOgImageUrl = (
    targetKind: 'cn' | 'org',
    channel: 'beta' | 'prod',
    token: string,
): string => {
    const cdnOrigin =
        targetKind === 'cn' ? TARGET_CN_CDN_ORIGIN : TARGET_ORG_CDN_ORIGIN;
    const variant = targetKind === 'cn' ? 'oss' : 'r2';
    const prefix = CDN_PREFIXES[targetKind][channel];
    return `${cdnOrigin}${prefix}/seo/og/${variant}/${encodeURIComponent(token)}.jpg`;
};

const resolvePointPreviewForTarget = (
    requestUrl: URL,
    targetOrigin: string,
): ResolvedSeoPointPreview | null => {
    const token = getPointPreviewToken(requestUrl);
    if (!token) return null;
    const targetKind = resolveTargetKind(targetOrigin);
    const channel = resolveTargetChannel(targetOrigin);
    const locale = resolvePreviewLocale(targetKind);
    const preview = SEO_POINT_PREVIEWS[locale][token] ?? null;
    if (!preview) return null;
    return {
        ...preview,
        url: buildPointCanonicalUrl(targetOrigin, token),
        image: buildPointOgImageUrl(targetKind, channel, token),
    };
};

const buildSocialPreviewHtml = (
    redirectUrl: string,
    targetOrigin: string,
    pointPreview?: ResolvedSeoPointPreview | null,
): string => {
    const escapedRedirectUrl = escapeHtml(redirectUrl);
    const previewUrl = pointPreview?.url || redirectUrl;
    const previewTitle = pointPreview?.title || PREVIEW_TITLE;
    const previewDescription = pointPreview?.description || PREVIEW_DESCRIPTION;
    const previewImageUrl =
        pointPreview?.image || buildPreviewImageUrl(targetOrigin);
    const escapedPreviewUrl = escapeHtml(previewUrl);
    const escapedTitle = escapeHtml(previewTitle);
    const escapedDescription = escapeHtml(previewDescription);
    const previewImage = escapeHtml(previewImageUrl);

    return `<!doctype html>
        <html lang="en">
        <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${escapedTitle}</title>
        <meta name="description" content="${escapedDescription}" />

        <meta property="og:type" content="website" />
        <meta property="og:title" content="${escapedTitle}" />
        <meta property="og:description" content="${escapedDescription}" />
        <meta property="og:url" content="${escapedPreviewUrl}" />
        <meta property="og:image" content="${previewImage}" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${escapedTitle}" />
        <meta name="twitter:description" content="${escapedDescription}" />
        <meta name="twitter:image" content="${previewImage}" />

        <meta http-equiv="refresh" content="0;url=${escapedRedirectUrl}" />
        </head>
        <body>
        <p>Redirecting to <a href="${escapedRedirectUrl}">${escapedRedirectUrl}</a></p>
        </body>
        </html>`;
};

const detectCountrySource = (request: Request): CountrySource => {
    const byHeader = request.headers.get('cf-ipcountry')?.toUpperCase();
    const cfCountry = (request as Request & { cf?: { country?: string } }).cf
        ?.country;
    const byCfCountry =
        typeof cfCountry === 'string' ? cfCountry.toUpperCase() : undefined;

    return { byHeader, byCfCountry };
};

const resolveTargetOrigin = (
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

const buildRedirectUrl = (requestUrl: URL, targetOrigin: string): string => {
    const intelImportToken = getIntelImportToken(requestUrl);
    if (intelImportToken) {
        const targetUrl = new URL('/intel', targetOrigin);
        targetUrl.searchParams.set('import', intelImportToken);
        return targetUrl.toString();
    }

    const targetUrl = new URL(
        requestUrl.pathname + requestUrl.search,
        targetOrigin,
    );
    return targetUrl.toString();
};

export const handleForwardRequest = async (
    request: Request,
): Promise<Response> => {
    const requestUrl = new URL(request.url);
    const userAgent = request.headers.get('user-agent') ?? '';
    const isDebugRequest =
        requestUrl.pathname === '/_debug' ||
        requestUrl.searchParams.get('__debug') === '1';
    const forcePreview = requestUrl.searchParams.get('__preview') === '1';
    const hostDecision = resolveHostDecision(requestUrl.hostname);
    const country = detectCountrySource(request);
    const mode = hostDecision.rule?.mode ?? 'geo';
    const target = resolveTargetOrigin(country, mode, hostDecision);
    const redirectUrl = buildRedirectUrl(requestUrl, target.origin);
    const isSocialPreview = shouldServeSocialPreview(userAgent, forcePreview);

    if (isDebugRequest) {
        const debugProfile = collectDebugProfile(request);
        return new Response(
            JSON.stringify(
                {
                    ok: true,
                    worker: 'oem-relink',
                    version: WORKER_VERSION,
                    host: requestUrl.host,
                    path: requestUrl.pathname,
                    search: requestUrl.search,
                    hostDecision,
                    decision: target,
                    isSocialPreview,
                    isIntelImport: Boolean(getIntelImportToken(requestUrl)),
                    isIntelImportDebug: isIntelImportDebugRequest(requestUrl),
                    redirectUrl,
                    country,
                    profile: debugProfile,
                },
                null,
                2,
            ),
            {
                status: 200,
                headers: {
                    'content-type': 'application/json; charset=utf-8',
                    'cache-control': 'no-store',
                },
            },
        );
    }

    if (!hostDecision.allowed) {
        return new Response('Not Found', {
            status: 404,
            headers: {
                'cache-control': 'no-store',
                'x-oem-relink-version': WORKER_VERSION,
                'x-oem-relink-host': hostDecision.hostname,
                'x-oem-relink-host-reason': hostDecision.reason,
            },
        });
    }

    const hostReason = `host=${hostDecision.key}; ${target.reason}`;

    if (isIntelImportDebugRequest(requestUrl)) {
        const intelImportToken = getIntelImportToken(requestUrl);
        try {
            const payload = await decodeIntelImportDebugPayload(
                intelImportToken ?? '',
            );
            return jsonResponse({
                ok: true,
                worker: 'oem-relink',
                version: WORKER_VERSION,
                payload,
            });
        } catch (error) {
            return jsonResponse(
                {
                    ok: false,
                    worker: 'oem-relink',
                    version: WORKER_VERSION,
                    error:
                        error instanceof Error
                            ? error.message
                            : 'The import payload could not be decoded.',
                },
                400,
            );
        }
    }

    if (isSocialPreview) {
        const pointPreview = resolvePointPreviewForTarget(
            requestUrl,
            target.origin,
        );
        return new Response(
            buildSocialPreviewHtml(redirectUrl, target.origin, pointPreview),
            {
                status: 200,
                headers: {
                    'content-type': 'text/html; charset=utf-8',
                    'cache-control': 'no-store',
                    'content-security-policy':
                        "default-src 'none'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
                    'x-frame-options': 'DENY',
                    'x-content-type-options': 'nosniff',
                    'referrer-policy': 'no-referrer',
                    'x-oem-relink-version': WORKER_VERSION,
                    'x-oem-relink-reason': hostReason,
                    'x-oem-relink-target': target.origin,
                    'x-oem-relink-host-key': hostDecision.key,
                    'x-oem-relink-mode': mode,
                    'x-oem-relink-social-preview': '1',
                    'x-oem-relink-point-preview': pointPreview ? '1' : '0',
                },
            },
        );
    }

    return new Response(null, {
        status: 302,
        headers: {
            location: redirectUrl,
            'cache-control': 'no-store',
            'x-oem-relink-version': WORKER_VERSION,
            'x-oem-relink-reason': hostReason,
            'x-oem-relink-target': target.origin,
            'x-oem-relink-host-key': hostDecision.key,
            'x-oem-relink-mode': mode,
            'x-oem-relink-country-header': country.byHeader ?? '',
            'x-oem-relink-country-cf': country.byCfCountry ?? '',
        },
    });
};

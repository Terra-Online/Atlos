const TARGET_CN_ORIGIN = 'https://opendfieldmap.cn';
const TARGET_ORG_ORIGIN = 'https://opendfieldmap.org';
const ROOT_SHORT_DOMAIN = 'oem.re';
const WORKER_VERSION = '20260408.02';
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

type RedirectMode = 'geo' | 'org' | 'cn';

type HostRule = {
	mode: RedirectMode;
	description: string;
	preserveSubdomain?: boolean;
};

type HostDecision = {
	allowed: boolean;
	hostname: string;
	key: string;
	rule?: HostRule;
	reason: string;
};

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

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === 'object' && value !== null;

const getRequestCf = (request: Request): UnknownRecord => {
	const cf = (request as Request & { cf?: unknown }).cf;
	return isRecord(cf) ? cf : {};
};

const getStringValue = (obj: UnknownRecord, key: string): string | undefined => {
	const value = obj[key];
	return typeof value === 'string' ? value : undefined;
};

const getNumberValue = (obj: UnknownRecord, key: string): number | undefined => {
	const value = obj[key];
	return typeof value === 'number' ? value : undefined;
};

const getBooleanValue = (obj: UnknownRecord, key: string): boolean | undefined => {
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

const setIfHasValue = (target: UnknownRecord, key: string, value: unknown): void => {
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
	const botManagement = isRecord(cf.botManagement) ? cf.botManagement : undefined;

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
	setIfHasValue(geo, 'isEUCountry', getBooleanValue(cf, 'isEUCountry') ?? getStringValue(cf, 'isEUCountry'));
	setIfHasValue(profile, 'geo', geo);

	const network: UnknownRecord = {};
	setIfHasValue(network, 'asn', getNumberValue(cf, 'asn') ?? getStringValue(cf, 'asn'));
	setIfHasValue(network, 'asOrganization', getStringValue(cf, 'asOrganization'));
	setIfHasValue(network, 'colo', getStringValue(cf, 'colo'));
	setIfHasValue(network, 'httpProtocol', getStringValue(cf, 'httpProtocol'));
	setIfHasValue(network, 'clientTcpRtt', getNumberValue(cf, 'clientTcpRtt'));
	setIfHasValue(network, 'clientQuicRtt', getNumberValue(cf, 'clientQuicRtt'));
	setIfHasValue(network, 'requestPriority', getStringValue(cf, 'requestPriority'));
	setIfHasValue(network, 'edgeRequestKeepAliveStatus', getNumberValue(cf, 'edgeRequestKeepAliveStatus'));
	setIfHasValue(profile, 'network', network);

	const bot: UnknownRecord = {};
	setIfHasValue(bot, 'verifiedBotCategory', getStringValue(cf, 'verifiedBotCategory'));
	setIfHasValue(bot, 'botManagement', botManagement);
	setIfHasValue(profile, 'bot', bot);

	const clientHints: UnknownRecord = {};
	setIfHasValue(clientHints, 'secChUa', request.headers.get('sec-ch-ua'));
	setIfHasValue(clientHints, 'secChUaMobile', request.headers.get('sec-ch-ua-mobile'));
	setIfHasValue(clientHints, 'secChUaPlatform', request.headers.get('sec-ch-ua-platform'));
	setIfHasValue(clientHints, 'secChUaPlatformVersion', request.headers.get('sec-ch-ua-platform-version'));
	setIfHasValue(clientHints, 'secChUaArch', request.headers.get('sec-ch-ua-arch'));
	setIfHasValue(clientHints, 'secChUaModel', request.headers.get('sec-ch-ua-model'));
	setIfHasValue(clientHints, 'secChUaFullVersion', request.headers.get('sec-ch-ua-full-version'));
	setIfHasValue(clientHints, 'secChUaFullVersionList', request.headers.get('sec-ch-ua-full-version-list'));

	const networkHints: UnknownRecord = {};
	setIfHasValue(networkHints, 'downlink', request.headers.get('downlink'));
	setIfHasValue(networkHints, 'ect', request.headers.get('ect'));
	setIfHasValue(networkHints, 'rtt', request.headers.get('rtt'));
	setIfHasValue(networkHints, 'saveData', request.headers.get('save-data'));

	const headers: UnknownRecord = {};
	setIfHasValue(headers, 'cfIpCountry', request.headers.get('cf-ipcountry'));
	setIfHasValue(headers, 'cfConnectingIp', request.headers.get('cf-connecting-ip'));
	setIfHasValue(headers, 'cfRay', request.headers.get('cf-ray'));
	setIfHasValue(headers, 'cfVisitor', parseJsonHeader(request, 'cf-visitor'));
	setIfHasValue(headers, 'userAgent', request.headers.get('user-agent'));
	setIfHasValue(headers, 'acceptLanguage', request.headers.get('accept-language'));
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

const shouldServeSocialPreview = (userAgent: string, forcePreview: boolean): boolean => {
	if (forcePreview) {
		return true;
	}
	const normalizedUserAgent = userAgent.toLowerCase();
	return SOCIAL_PREVIEW_BOT_KEYWORDS.some((keyword) => normalizedUserAgent.includes(keyword));
};

const buildPreviewImageUrl = (targetOrigin: string): string =>
	new URL('/og_preview.jpg', targetOrigin).toString();

const buildSocialPreviewHtml = (redirectUrl: string, targetOrigin: string): string => {
	const escapedRedirectUrl = escapeHtml(redirectUrl);
	const escapedTitle = escapeHtml(PREVIEW_TITLE);
	const escapedDescription = escapeHtml(PREVIEW_DESCRIPTION);
	const previewImage = escapeHtml(buildPreviewImageUrl(targetOrigin));

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
        <meta property="og:url" content="${escapedRedirectUrl}" />
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
	const cfCountry = (request as Request & { cf?: { country?: string } }).cf?.country;
	const byCfCountry = typeof cfCountry === 'string' ? cfCountry.toUpperCase() : undefined;

	return { byHeader, byCfCountry };
};

const normalizeHostname = (hostname: string): string =>
	hostname.trim().toLowerCase().replace(/\.+$/, '');

const resolveHostDecision = (hostname: string): HostDecision => {
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
	const targetUrl = new URL(requestUrl.pathname + requestUrl.search, targetOrigin);
	return targetUrl.toString();
};

export default {
	fetch(request: Request): Response {
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

		if (isSocialPreview) {
			return new Response(buildSocialPreviewHtml(redirectUrl, target.origin), {
				status: 200,
				headers: {
					'content-type': 'text/html; charset=utf-8',
					'cache-control': 'no-store',
					'content-security-policy': "default-src 'none'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
					'x-frame-options': 'DENY',
					'x-content-type-options': 'nosniff',
					'referrer-policy': 'no-referrer',
					'x-oem-relink-version': WORKER_VERSION,
					'x-oem-relink-reason': hostReason,
					'x-oem-relink-target': target.origin,
					'x-oem-relink-host-key': hostDecision.key,
					'x-oem-relink-mode': mode,
					'x-oem-relink-social-preview': '1',
				},
			});
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
	},
};

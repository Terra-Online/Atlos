import { WORKER_VERSION } from './version';

interface R2ObjectLike {
    text(): Promise<string>;
}

interface R2BucketLike {
    get(key: string): Promise<R2ObjectLike | null>;
}

export interface Env {
    OEA_PACKAGES?: R2BucketLike;
}

type UnknownRecord = Record<string, unknown>;

const OEA_HOSTNAME = 'oea.oem.re';
const OEA_PACKAGE_ORIGIN = 'https://package.oem.re';
const OEA_STABLE_KEY = 'channels/oea/stable.json';
const OEA_MAX_PACKAGE_SIZE = 512 * 1024 * 1024;
const OEA_SEMVER_PATTERN =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const OEA_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OEA_FILENAME_PATTERN =
    /^OEA-windows-x86_64-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\.zip$/;

interface OeaStableManifest {
    schemaVersion: 1;
    channel: 'stable';
    version: string;
    tag: string;
    filename: string;
    key: string;
    url: string;
    size: number;
    sha256: string;
    publishedAt: string;
}

const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === 'object' && value !== null;

const validateOeaStableManifest = (
    value: unknown,
): OeaStableManifest | null => {
    if (!isRecord(value)) return null;
    const keys = Object.keys(value).sort();
    const expectedKeys = [
        'channel',
        'filename',
        'key',
        'publishedAt',
        'schemaVersion',
        'sha256',
        'size',
        'tag',
        'url',
        'version',
    ];
    if (
        keys.length !== expectedKeys.length ||
        keys.some((key, index) => key !== expectedKeys[index])
    )
        return null;
    if (
        value.schemaVersion !== 1 ||
        value.channel !== 'stable' ||
        typeof value.version !== 'string' ||
        typeof value.tag !== 'string' ||
        typeof value.filename !== 'string' ||
        typeof value.key !== 'string' ||
        typeof value.url !== 'string' ||
        typeof value.size !== 'number' ||
        typeof value.sha256 !== 'string' ||
        typeof value.publishedAt !== 'string'
    )
        return null;
    if (
        !OEA_SEMVER_PATTERN.test(value.version) ||
        value.tag !== `v${value.version}`
    )
        return null;
    if (
        value.filename !== `OEA-windows-x86_64-v${value.version}.zip` ||
        !OEA_FILENAME_PATTERN.test(value.filename)
    )
        return null;
    const expectedKey = `releases/oea/${value.tag}/${value.filename}`;
    if (value.key !== expectedKey || !OEA_SHA256_PATTERN.test(value.sha256))
        return null;
    if (
        !Number.isSafeInteger(value.size) ||
        value.size <= 0 ||
        value.size >= OEA_MAX_PACKAGE_SIZE
    )
        return null;
    if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.publishedAt)
    )
        return null;
    if (Number.isNaN(Date.parse(value.publishedAt))) return null;
    try {
        const url = new URL(value.url);
        if (
            url.origin !== OEA_PACKAGE_ORIGIN ||
            url.pathname !== `/${expectedKey}` ||
            url.search ||
            url.hash
        )
            return null;
    } catch {
        return null;
    }
    return value as unknown as OeaStableManifest;
};

const handleOeaPackage = async (
    request: Request,
    env?: Env,
): Promise<Response | null> => {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname !== OEA_HOSTNAME) return null;
    const headers = new Headers({
        'cache-control': 'no-store',
        'x-oem-relink-version': WORKER_VERSION,
    });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        headers.set('allow', 'GET, HEAD');
        return new Response('Method Not Allowed', { status: 405, headers });
    }
    if (requestUrl.pathname !== '/' && requestUrl.pathname !== '/latest') {
        return new Response('Not Found', { status: 404, headers });
    }
    if (!env?.OEA_PACKAGES) {
        return new Response('Stable package is not available', {
            status: 503,
            headers,
        });
    }

    try {
        const object = await env.OEA_PACKAGES.get(OEA_STABLE_KEY);
        if (!object)
            return new Response('Stable package is not available', {
                status: 503,
                headers,
            });
        const manifest = validateOeaStableManifest(
            JSON.parse(await object.text()),
        );
        if (!manifest)
            return new Response('Stable package manifest is invalid', {
                status: 503,
                headers,
            });
        headers.set('location', manifest.url);
        headers.set('x-oem-relink-package-version', manifest.version);
        return new Response(null, { status: 302, headers });
    } catch {
        return new Response('Stable package is not available', {
            status: 503,
            headers,
        });
    }
};

type DownloadHandler = (
    request: Request,
    env?: Env,
) => Promise<Response | null>;

// Keep download entry points independent so new downloadable resources can
// be added without growing the forwarding worker's routing logic.
const DOWNLOAD_HANDLERS: readonly DownloadHandler[] = [handleOeaPackage];

export const handleDownloadRequest = async (
    request: Request,
    env?: Env,
): Promise<Response | null> => {
    for (const handler of DOWNLOAD_HANDLERS) {
        const response = await handler(request, env);
        if (response) return response;
    }
    return null;
};

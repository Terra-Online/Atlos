import { createElement, Fragment } from 'react';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { Element } from 'html-react-parser';
import { getAssetsHostPrefix } from '@/utils/resource';

export async function parseArchiveJsonResponse(res: Response): Promise<string | null> {
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (ct.includes('text/html')) return null;

    let data: unknown;
    try {
        data = await res.json();
    } catch {
        return null;
    }

    if (!data || typeof data !== 'object') return null;
    const content = (data as { content?: unknown }).content;
    if (typeof content !== 'string' || content.trim().length === 0) return null;
    return content;
}

const ensureWebpSuffix = (value: string): string => {
    const m = value.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
    if (!m) return value;

    const path = m[1] ?? '';
    const query = m[2] ?? '';
    const hash = m[3] ?? '';
    if (!path || path.endsWith('/')) return value;
    if (/\.[a-z0-9]+$/i.test(path)) return value;
    return `${path}.webp${query}${hash}`;
};

const joinAssetsPrefix = (pathLike: string): string => {
    const prefix = getAssetsHostPrefix().replace(/\/$/, '');
    const cleanPath = pathLike.replace(/^\//, '');
    if (!prefix) return `/${cleanPath}`;
    return `${prefix}/${cleanPath}`;
};

export function resolveArchiveHtmlAssetUrl(jsonResourceUrl: string, src: string): string {
    const s = src.trim();
    if (!s) return s;
    if (s.startsWith('data:')) return s;

    // Keep fully-qualified URLs as-is except for missing extension normalization.
    if (/^https?:\/\//i.test(s) || s.startsWith('//')) return ensureWebpSuffix(s);

    // `files/...` should always resolve from site root (not JSON directory).
    if (s.startsWith('files/')) return joinAssetsPrefix(ensureWebpSuffix(s));

    if (s.startsWith('/')) return joinAssetsPrefix(ensureWebpSuffix(s));

    if (typeof window === 'undefined') return ensureWebpSuffix(s);
    const absoluteJson = jsonResourceUrl.startsWith('http')
        ? jsonResourceUrl
        : `${window.location.origin}${jsonResourceUrl.startsWith('/') ? '' : '/'}${jsonResourceUrl}`;
    const slash = absoluteJson.lastIndexOf('/');
    const baseDir = slash >= 0 ? absoluteJson.slice(0, slash + 1) : `${absoluteJson}/`;
    try {
        return new URL(ensureWebpSuffix(s), baseDir).href;
    } catch {
        return ensureWebpSuffix(s);
    }
}

export function createArchiveHtmlParserOptions(archiveJsonUrl: string): HTMLReactParserOptions {
    return {
        replace(domNode) {
            if (!(domNode instanceof Element)) return undefined;
            const tag = (domNode.name ?? '').toLowerCase();
            if (tag === 'script') return createElement(Fragment);

            const attribs = domNode.attribs ?? {};
            Object.keys(attribs).forEach((attr) => {
                if (attr.toLowerCase().startsWith('on')) delete attribs[attr];
            });
            if (tag === 'a') {
                const href = (attribs.href ?? '').trim();
                if (href.toLowerCase().startsWith('javascript:')) delete attribs.href;
            }
            if (tag === 'img' && attribs.src && archiveJsonUrl) {
                attribs.src = resolveArchiveHtmlAssetUrl(archiveJsonUrl, attribs.src);
            }
            return undefined;
        },
    };
}

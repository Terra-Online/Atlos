import {
    Fragment,
    createElement,
    type MouseEventHandler,
    type ReactNode,
} from 'react';

const DOCS_BASE = 'https://blog.opendfieldmap.org';
const LINK_RE = /<a\s+href=["']\{([a-zA-Z0-9_-]+)\}["']>(.*?)<\/a>/gi;

export const DOCS_LOCALES = ['en', 'zh-cn', 'zh-hk', 'ja', 'ko', 'ru'] as const;
export type DocsLocale = (typeof DOCS_LOCALES)[number];

export const DOCS = {
    communityGuidelines: 'community-guidelines',
    privacy: 'privacy',
    tos: 'tos',
    dataCollection: 'data-collection',
    disclaimer: 'disclaimer',
} as const;

export type DocsKey = keyof typeof DOCS;

export const docsLocale = (locale?: string): DocsLocale => {
    const normalized = (locale || '').toLowerCase();
    if (normalized.startsWith('zh-cn')) return 'zh-cn';
    if (normalized.startsWith('zh-hk') || normalized.startsWith('zh-tw')) return 'zh-hk';
    if (normalized.startsWith('ja')) return 'ja';
    if (normalized.startsWith('ko')) return 'ko';
    if (normalized.startsWith('ru')) return 'ru';
    return 'en';
};

export const docsLink = (locale: string | undefined, key: DocsKey): string => (
    `${DOCS_BASE}/${docsLocale(locale)}/docs/${DOCS[key]}`
);

export const docsLinks = (locale?: string): Record<DocsKey, string> => (
    Object.fromEntries(
        Object.keys(DOCS).map((key) => [key, docsLink(locale, key as DocsKey)]),
    ) as Record<DocsKey, string>
);

export const linksTpl = (
    text: string,
    urls: Record<string, string>,
    onClick?: MouseEventHandler<HTMLAnchorElement>,
): ReactNode => {
    const template = text;
    const nodes: ReactNode[] = [];
    let lastIndex = 0;
    let index = 0;

    LINK_RE.lastIndex = 0;
    for (const match of template.matchAll(LINK_RE)) {
        const start = match.index ?? 0;
        const href = urls[match[1]];
        if (start > lastIndex) {
            nodes.push(template.slice(lastIndex, start));
        }
        nodes.push(href
            ? createElement(
                'a',
                {
                    key: `${match[1]}:${index}`,
                    href,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    onClick,
                },
                match[2],
            )
            : match[2]);
        lastIndex = start + match[0].length;
        index += 1;
    }

    if (lastIndex < template.length) {
        nodes.push(template.slice(lastIndex));
    }
    return nodes.length ? createElement(Fragment, null, ...nodes) : template;
};

export const linkTpl = (
    text: string,
    url: string,
    onClick?: MouseEventHandler<HTMLAnchorElement>,
): ReactNode => linksTpl(text, { link: url }, onClick);

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import IntlMessageFormat from 'intl-messageformat';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const regions = { CN: 'zh-CN', HK: 'zh-HK', JP: 'ja-JP' };

// Only literals contribute glyphs; argument names and ICU selectors do not.
export const literalText = (message, locale) => {
    const walk = (nodes) =>
        nodes
            .flatMap((node) => [
                node.type === 0
                    ? node.value
                    : node.type === 7
                      ? '0123456789'
                      : '',
                ...(node.children ? [walk(node.children)] : []),
                ...Object.values(node.options || {}).map((option) =>
                    walk(option.value),
                ),
            ])
            .join('');
    return walk(
        new IntlMessageFormat(message, locale, undefined, {
            ignoreTag: true,
        }).getAst(),
    ).normalize('NFC');
};

const strings = (value) =>
    typeof value === 'string'
        ? [value]
        : value && typeof value === 'object'
          ? Object.values(value).flatMap(strings)
          : [];

export const uiCharacters = async () => {
    const result = {};
    for (const [region, locale] of Object.entries(regions)) {
        const characters = new Set(
            Array.from({ length: 95 }, (_, i) => String.fromCodePoint(32 + i)),
        );
        for (const app of ['', 'apps/intel', 'apps/user-hub']) {
            const data = JSON.parse(
                await fs.readFile(
                    path.join(
                        root,
                        app,
                        'src/locale/data/ui',
                        `${locale}.json`,
                    ),
                    'utf8',
                ),
            );
            for (const text of strings(data))
                for (const char of literalText(text, locale))
                    characters.add(char);
        }
        result[region] = [...characters]
            .sort((a, b) => a.codePointAt(0) - b.codePointAt(0))
            .join('');
    }
    return result;
};

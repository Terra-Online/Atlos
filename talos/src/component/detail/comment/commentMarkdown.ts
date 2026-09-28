import { getCommentEmojiUrl } from './emojiData';

export type CommentFormat = 'bold' | 'italic' | 'boldItalic' | 'underline' | 'strike' | 'code';

export type CommentInlineNode =
    | string
    | { type: 'emoji'; id: string; url: string }
    | { type: 'format'; format: CommentFormat; children: CommentInlineNode[] }
    | { type: 'link'; href: string; children: CommentInlineNode[] };

export type CommentSourceNode =
    | { type: 'text'; value: string }
    | { type: 'token'; value: string }
    | { type: 'emoji'; id: string; url: string }
    | {
        type: 'format';
        format: CommentFormat;
        opening: string;
        closing: string;
        children: CommentSourceNode[];
    }
    | {
        type: 'link';
        href: string;
        opening: string;
        closing: string;
        children: CommentSourceNode[];
    };

const delimiters: Array<{ token: string; format: CommentFormat }> = [
    { token: '***', format: 'boldItalic' },
    { token: '___', format: 'boldItalic' },
    { token: '**', format: 'bold' },
    { token: '__', format: 'underline' },
    { token: '~~', format: 'strike' },
    { token: '`', format: 'code' },
    { token: '*', format: 'italic' },
];

const isEscaped = (source: string, index: number): boolean => {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
        slashes += 1;
    }
    return slashes % 2 === 1;
};

const findClosingDelimiter = (source: string, token: string, start: number): number => {
    for (let cursor = start; cursor <= source.length - token.length; cursor += 1) {
        if (!source.startsWith(token, cursor) || isEscaped(source, cursor)) continue;
        if (token === '**' && source.startsWith('***', cursor)) return cursor + 1;
        if (token.startsWith('*')) {
            const before = source[cursor - 1] === '*';
            const after = source[cursor + token.length] === '*';
            if (token === '***' && (before || after)) continue;
            if (token === '**' && (before || after)) continue;
            if (token === '*' && (before || after)) continue;
        }
        return cursor;
    }
    return -1;
};

const isSafeLink = (href: string): boolean => {
    try {
        const url = new URL(href, 'https://oem.re');
        return ['http:', 'https:', 'mailto:'].includes(url.protocol);
    } catch {
        return false;
    }
};

const parseInline = (source: string, depth = 0): CommentInlineNode[] => {
    if (depth > 16) return [source];

    const nodes: CommentInlineNode[] = [];
    let text = '';
    const flushText = () => {
        if (!text) return;
        nodes.push(text);
        text = '';
    };

    for (let cursor = 0; cursor < source.length;) {
        const character = source[cursor];
        if (character === '\\' && cursor + 1 < source.length && /[\\*_`[\]():~]/.test(source[cursor + 1] ?? '')) {
            text += source[cursor + 1];
            cursor += 2;
            continue;
        }

        if (character === ':') {
            const emojiMatch = /^:sns_(\d{3}):/.exec(source.slice(cursor));
            const id = emojiMatch?.[1];
            const url = id ? getCommentEmojiUrl(id) : undefined;
            if (emojiMatch && id && url) {
                flushText();
                nodes.push({ type: 'emoji', id, url });
                cursor += emojiMatch[0].length;
                continue;
            }
        }

        if (character === '[') {
            const labelEnd = source.indexOf('](', cursor + 1);
            const urlEnd = labelEnd < 0 ? -1 : source.indexOf(')', labelEnd + 2);
            if (labelEnd > cursor + 1 && urlEnd > labelEnd + 2) {
                const href = source.slice(labelEnd + 2, urlEnd).trim();
                if (href && isSafeLink(href)) {
                    flushText();
                    nodes.push({
                        type: 'link',
                        href,
                        children: parseInline(source.slice(cursor + 1, labelEnd), depth + 1),
                    });
                    cursor = urlEnd + 1;
                    continue;
                }
            }
        }

        let matchedFormat = false;
        for (const { token, format } of delimiters) {
            if (!source.startsWith(token, cursor) || isEscaped(source, cursor)) continue;
            if (token.startsWith('*') && source[cursor - 1] === '*') continue;
            if (token.startsWith('*') && source[cursor + token.length] === '*') continue;
            const closing = findClosingDelimiter(source, token, cursor + token.length);
            if (closing <= cursor + token.length) continue;

            flushText();
            nodes.push({
                type: 'format',
                format,
                children: format === 'code'
                    ? [source.slice(cursor + token.length, closing)]
                    : parseInline(source.slice(cursor + token.length, closing), depth + 1),
            });
            cursor = closing + token.length;
            matchedFormat = true;
            break;
        }
        if (matchedFormat) continue;

        text += character;
        cursor += 1;
    }

    flushText();
    return nodes;
};

export const parseCommentContent = (content: string): CommentInlineNode[] => parseInline(content);

const sourceDelimiters: Array<{ token: string; format: CommentFormat }> = [
    { token: '***', format: 'boldItalic' },
    { token: '___', format: 'boldItalic' },
    { token: '**', format: 'bold' },
    { token: '__', format: 'underline' },
    { token: '~~', format: 'strike' },
    { token: '`', format: 'code' },
    { token: '*', format: 'italic' },
];

const findSourceClosingDelimiter = (source: string, token: string, start: number): number => {
    for (let cursor = start; cursor <= source.length - token.length; cursor += 1) {
        if (!source.startsWith(token, cursor) || isEscaped(source, cursor)) continue;
        if (token === '**' && source.startsWith('***', cursor)) {
            const inner = source.slice(start, cursor);
            let singleStarCount = 0;
            for (let index = 0; index < inner.length; index += 1) {
                if (
                    inner[index] === '*'
                    && !isEscaped(inner, index)
                    && inner[index - 1] !== '*'
                    && inner[index + 1] !== '*'
                ) {
                    singleStarCount += 1;
                }
            }
            return singleStarCount % 2 === 1 ? cursor + 1 : cursor;
        }
        if (token.startsWith('*')) {
            const before = source[cursor - 1] === '*';
            const after = source[cursor + token.length] === '*';
            if (before || after) continue;
        }
        return cursor;
    }
    return -1;
};

const parseSourceInline = (source: string, depth = 0): CommentSourceNode[] => {
    if (depth > 16) return source ? [{ type: 'text', value: source }] : [];

    const nodes: CommentSourceNode[] = [];
    let text = '';
    const flushText = () => {
        if (!text) return;
        nodes.push({ type: 'text', value: text });
        text = '';
    };

    for (let cursor = 0; cursor < source.length;) {
        const character = source[cursor];

        if (character === '\\' && cursor + 1 < source.length) {
            // Keep escapes in the editor source. They still prevent the escaped
            // character from being interpreted as Markdown below.
            text += source.slice(cursor, cursor + 2);
            cursor += 2;
            continue;
        }

        if (character === ':') {
            const emojiMatch = /^:sns_(\d{3}):/.exec(source.slice(cursor));
            const id = emojiMatch?.[1];
            const url = id ? getCommentEmojiUrl(id) : undefined;
            if (emojiMatch && id && url) {
                flushText();
                nodes.push({ type: 'emoji', id, url });
                cursor += emojiMatch[0].length;
                continue;
            }
        }

        if (character === '[') {
            const labelEnd = source.indexOf('](', cursor + 1);
            const urlEnd = labelEnd < 0 ? -1 : source.indexOf(')', labelEnd + 2);
            if (labelEnd > cursor + 1 && urlEnd > labelEnd + 2) {
                const rawHref = source.slice(labelEnd + 2, urlEnd);
                const href = rawHref.trim();
                if (href && isSafeLink(href)) {
                    flushText();
                    nodes.push({
                        type: 'link',
                        href,
                        opening: '[',
                        closing: `](${rawHref})`,
                        children: parseSourceInline(source.slice(cursor + 1, labelEnd), depth + 1),
                    });
                    cursor = urlEnd + 1;
                    continue;
                }
            }
        }

        let matchedFormat = false;
        for (const { token, format } of sourceDelimiters) {
            if (!source.startsWith(token, cursor) || isEscaped(source, cursor)) continue;
            if (token.startsWith('*') && source[cursor - 1] === '*') continue;
            if (token.startsWith('*') && source[cursor + token.length] === '*') continue;

            const closing = findSourceClosingDelimiter(source, token, cursor + token.length);
            if (closing <= cursor + token.length) continue;

            flushText();
            nodes.push({
                type: 'format',
                format,
                opening: token,
                closing: token,
                children: format === 'code'
                    ? [{ type: 'text', value: source.slice(cursor + token.length, closing) }]
                    : parseSourceInline(source.slice(cursor + token.length, closing), depth + 1),
            });
            cursor = closing + token.length;
            matchedFormat = true;
            break;
        }
        if (matchedFormat) continue;

        text += character;
        cursor += 1;
    }

    flushText();
    return nodes;
};

export const parseCommentSource = (content: string): CommentSourceNode[] => (
    parseSourceInline(content)
);

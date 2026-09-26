import {
    $createLineBreakNode,
    $createTextNode,
    $getRoot,
    $isElementNode,
    $isTextNode,
    type LexicalNode,
    type TextFormatType,
} from 'lexical';
import { $createLinkNode } from '@lexical/link';
import {
    parseCommentSource,
    type CommentFormat,
    type CommentSourceNode,
} from './commentMarkdown';

type EmojiNodeFactory = (id: string) => LexicalNode;

const lexicalFormatByCommentFormat: Record<CommentFormat, TextFormatType | null> = {
    bold: 'bold', italic: 'italic', boldItalic: null, underline: 'underline',
    strike: 'strikethrough', code: 'code',
};
const COMMENT_SOURCE_TOKEN_STYLE = 'opacity: 0.48';

const createSourceTextNodes = (value: string, formats: TextFormatType[], token = false): LexicalNode[] => {
    const result: LexicalNode[] = [];
    value.split('\n').forEach((line, index, lines) => {
        if (line) {
            const node = $createTextNode(line);
            formats.forEach((format) => node.toggleFormat(format));
            if (token) node.setStyle(COMMENT_SOURCE_TOKEN_STYLE);
            result.push(node);
        }
        if (index < lines.length - 1) result.push($createLineBreakNode());
    });
    return result;
};

const createNodesFromSource = (
    nodes: CommentSourceNode[],
    createEmoji: EmojiNodeFactory,
    formats: TextFormatType[] = [],
): LexicalNode[] => (
    nodes.flatMap((node) => {
        if (node.type === 'text') return createSourceTextNodes(node.value, formats);
        if (node.type === 'token') return createSourceTextNodes(node.value, [], true);
        if (node.type === 'emoji') return [createEmoji(node.id)];
        if (node.type === 'format') {
            const format = node.format === 'boldItalic'
                ? [...formats, 'bold' as const, 'italic' as const]
                : lexicalFormatByCommentFormat[node.format]
                    ? [...formats, lexicalFormatByCommentFormat[node.format] as TextFormatType]
                    : formats;
            return [
                ...createSourceTextNodes(node.opening, [], true),
                ...createNodesFromSource(node.children, createEmoji, format),
                ...createSourceTextNodes(node.closing, [], true),
            ];
        }
        const link = $createLinkNode(node.href, { rel: 'nofollow noopener noreferrer', target: '_blank' });
        link.append(...createNodesFromSource(node.children, createEmoji, formats));
        return [
            ...createSourceTextNodes(node.opening, [], true),
            link,
            ...createSourceTextNodes(node.closing, [], true),
        ];
    })
);

export const serializeCommentNode = (node: LexicalNode): string => {
    if ($isTextNode(node)) return node.getTextContent();
    if (node.getType() === 'linebreak') return '\n';
    if ($isElementNode(node)) return node.getChildren().map(serializeCommentNode).join('');
    return node.getTextContent();
};

export const getCommentRawText = (): string => serializeCommentNode($getRoot());

export const createCommentSourceNodes = (raw: string, createEmoji: EmojiNodeFactory): LexicalNode[] => (
    createNodesFromSource(parseCommentSource(raw), createEmoji)
);

const sourceShape = (node: CommentSourceNode): string => {
    if (node.type === 'text') return 'text';
    if (node.type === 'token') return 'token';
    if (node.type === 'emoji') return 'emoji';
    if (node.type === 'format') return `format:${node.format}[${node.children.map(sourceShape).join(',')}]`;
    return `link:${node.href}[${node.children.map(sourceShape).join(',')}]`;
};

export const commentSourceShape = (raw: string): string => (
    parseCommentSource(raw).map(sourceShape).join('|')
);

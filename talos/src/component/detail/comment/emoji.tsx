import { Fragment } from 'react';
import styles from './comments.module.scss';
import { commentEmojiToken } from './emojiData';
import { parseCommentContent, type CommentInlineNode } from './commentMarkdown';

const renderNodes = (nodes: CommentInlineNode[]) => nodes.map((node, index) => {
    if (typeof node === 'string') return <Fragment key={`text-${index}`}>{node}</Fragment>;
    if (node.type === 'emoji') {
        return (
            <img
                key={`emoji-${node.id}-${index}`}
                className={styles.commentEmoji}
                src={node.url}
                alt={commentEmojiToken(node.id)}
                title={commentEmojiToken(node.id)}
                draggable={false}
            />
        );
    }
    if (node.type === 'link') {
        return (
            <a
                key={`link-${index}`}
                className={styles.commentMarkdownLink}
                href={node.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
            >
                {renderNodes(node.children)}
            </a>
        );
    }

    const children = renderNodes(node.children);
    const key = `${node.format}-${index}`;
    switch (node.format) {
        case 'bold': return <strong key={key}>{children}</strong>;
        case 'italic': return <em key={key}>{children}</em>;
        case 'boldItalic': return <strong key={key}><em>{children}</em></strong>;
        case 'underline': return <u key={key}>{children}</u>;
        case 'strike': return <s key={key}>{children}</s>;
        case 'code': return <code key={key} className={styles.commentMarkdownCode}>{children}</code>;
    }
});

export const CommentContent = ({ content }: { content: string }) => (
    <>{renderNodes(parseCommentContent(content))}</>
);

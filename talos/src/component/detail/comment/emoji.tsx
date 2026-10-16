import { Fragment, useState, type ReactNode } from 'react';
import PopoverTooltip from '@/component/popover/popover';
import { useTranslateUI } from '@/locale';
import styles from './comments.module.scss';
import { commentEmojiToken } from './emojiData';
import { parseCommentContent, type CommentInlineNode } from './commentMarkdown';

const Spoiler = ({ children }: { children: ReactNode }) => {
    const tUI = useTranslateUI();
    const [revealed, setRevealed] = useState(false);
    const [focused, setFocused] = useState(false);
    const [hovered, setHovered] = useState(false);
    const label = tUI(revealed ? 'detail.comments.spoilerRevealed' : 'detail.comments.spoilerHidden');
    return (
        <PopoverTooltip content={label} placement="top" anchor="first-line" gap={8} visible={focused || hovered}>
            <span
                className={styles.commentSpoiler}
                data-revealed={revealed}
                role="button"
                tabIndex={0}
                aria-expanded={revealed}
                aria-label="Spoiler"
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onClick={(event) => {
                    if (revealed) return;
                    // The first click reveals the spoiler, including any links inside it.
                    event.preventDefault();
                    event.stopPropagation();
                    setRevealed(true);
                }}
                onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        event.stopPropagation();
                        setRevealed(true);
                    }
                }}
            >
                <span className={styles.commentSpoilerContent} aria-hidden={!revealed} inert={!revealed}>
                    {children}
                </span>
            </span>
        </PopoverTooltip>
    );
};

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
        case 'spoiler': return <Spoiler key={key}>{children}</Spoiler>;
        case 'code': return <code key={key} className={styles.commentMarkdownCode}>{children}</code>;
    }
});

export const CommentContent = ({ content }: { content: string }) => (
    <Fragment key={content}>{renderNodes(parseCommentContent(content))}</Fragment>
);

import React from 'react';
import { $applyNodeReplacement, DecoratorNode, type NodeKey, type SerializedLexicalNode } from 'lexical';
import styles from './comments.module.scss';
import { commentEmojiToken, getCommentEmojiUrl } from './emojiData';

type SerializedCommentEmojiNode = SerializedLexicalNode & { id: string };

export class CommentEmojiNode extends DecoratorNode<React.ReactNode> {
    __id: string;

    static override getType(): string { return 'comment-emoji'; }
    static override clone(node: CommentEmojiNode): CommentEmojiNode {
        return new CommentEmojiNode(node.__id, node.__key);
    }
    constructor(id: string, key?: NodeKey) { super(key); this.__id = id; }
    override createDOM(): HTMLElement {
        const element = document.createElement('span');
        element.className = styles.commentEmojiDecorator;
        return element;
    }
    override updateDOM(): false { return false; }
    override decorate(): React.ReactNode {
        const url = getCommentEmojiUrl(this.__id);
        if (!url) return null;
        return <img className={styles.commentEmoji} src={url} alt={commentEmojiToken(this.__id)} title={commentEmojiToken(this.__id)} draggable={false} />;
    }
    override getTextContent(): string { return commentEmojiToken(this.__id); }
    override exportJSON(): SerializedCommentEmojiNode {
        return { ...super.exportJSON(), type: 'comment-emoji', version: 1, id: this.__id };
    }
    static override importJSON(node: SerializedCommentEmojiNode): CommentEmojiNode {
        return $createCommentEmojiNode(node.id);
    }
}

export const $createCommentEmojiNode = (id: string): CommentEmojiNode => (
    $applyNodeReplacement(new CommentEmojiNode(id))
);

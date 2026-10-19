import { useEffect, useId } from 'react';
import { $getRoot, $isElementNode, $isTextNode, type LexicalNode } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { getCommentLength } from './commentMarkdown';
import { serializeCommentNode } from './commentEditorSource';

const CommentEditorOverflow = ({ maxLength }: { maxLength: number }) => {
    const [editor] = useLexicalComposerContext();
    const name = `comment-overflow-${useId().replace(/[^a-z0-9-]/gi, '')}`;

    useEffect(() => {
        // DOM ranges leave Lexical's nodes, history and IME composition untouched.
        const update = () => editor.getEditorState().read(() => {
            const ranges: Range[] = [];
            let offset = 0;
            const visit = (node: LexicalNode) => {
                if ($isElementNode(node)) {
                    node.getChildren().forEach(visit);
                    return;
                }
                const length = node.getType() === 'comment-emoji' ? 2 : serializeCommentNode(node).length;
                const element = editor.getElementByKey(node.getKey());
                const start = Math.max(0, maxLength - offset);
                if ($isTextNode(node) && element?.firstChild instanceof Text && start < length) {
                    const range = document.createRange();
                    // Keep a surrogate pair together at the boundary.
                    const text = node.getTextContent();
                    const boundary = start > 0 && /[\uDC00-\uDFFF]/.test(text[start]) ? start - 1 : start;
                    range.setStart(element.firstChild, boundary);
                    range.setEnd(element.firstChild, length);
                    ranges.push(range);
                }
                if (node.getType() === 'comment-emoji' && element) {
                    element.toggleAttribute('data-over-limit', start < length);
                }
                offset += length;
            };
            visit($getRoot());
            const root = editor.getRootElement();
            const count = getCommentLength(serializeCommentNode($getRoot()));
            root?.toggleAttribute('data-over-limit', count > maxLength);
            const lastLine = root
                ? [...root.children].reverse().find((element) => element.tagName === 'P')
                : null;
            if (lastLine instanceof HTMLElement) {
                const label = `(${count}/${maxLength})`;
                if (lastLine.dataset.commentLength !== label) lastLine.dataset.commentLength = label;
            }
            if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
                CSS.highlights.set(name, new Highlight(...ranges));
            }
        });
        let frame = 0;
        const scheduleUpdate = () => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                update();
            });
        };
        const syncUpdate = () => {
            update();
            scheduleUpdate();
        };
        syncUpdate();
        const unregister = editor.registerUpdateListener(syncUpdate);
        const root = editor.getRootElement();
        const observer = root ? new MutationObserver(scheduleUpdate) : null;
        observer?.observe(root as Node, {
            attributes: true,
            attributeFilter: ['data-comment-length', 'data-over-limit'],
            childList: true,
            characterData: true,
            subtree: true,
        });
        return () => {
            unregister();
            observer?.disconnect();
            window.cancelAnimationFrame(frame);
            if (typeof CSS !== 'undefined') CSS.highlights?.delete(name);
        };
    }, [editor, maxLength, name]);

    return <style>{`::highlight(${name}) { color: var(--comment-overflow); }`}</style>;
};

export default CommentEditorOverflow;

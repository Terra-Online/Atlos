import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
} from 'react';
import {
    $addUpdateTag,
    $createParagraphNode,
    $getRoot,
    $getSelection,
    $isElementNode,
    $isRangeSelection,
    COMMAND_PRIORITY_HIGH,
    CONTROLLED_TEXT_INSERTION_COMMAND,
    INSERT_LINE_BREAK_COMMAND,
    INSERT_PARAGRAPH_COMMAND,
    KEY_DOWN_COMMAND,
    KEY_ENTER_COMMAND,
    PASTE_COMMAND,
    HISTORY_MERGE_TAG,
    SKIP_SCROLL_INTO_VIEW_TAG,
    type TextFormatType,
} from 'lexical';
import { LinkNode } from '@lexical/link';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalComposer, type InitialConfigType } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import type { Ref } from 'react';
import styles from '@/pages/detail/comment/comments.module.scss';
import CommentEditorToolbar from '@/pages/detail/comment/commentEditorToolbar';
import CommentEditorOverflow from '@/pages/detail/comment/commentEditorOverflow';
import { getCommentLength } from '@/component/shared/comments/commentMarkdown';
import { commentEmojiToken, getCommentEmojiUrl } from '@/component/shared/comments/emojiData';
import { $createCommentEmojiNode, CommentEmojiNode } from '@/pages/detail/comment/commentEditorEmojiNode';
import {
    createCommentSourceNodes,
    commentSourceShape,
    getCommentRawText,
    serializeCommentNode,
} from '@/pages/detail/comment/commentEditorSource';
import {
    getCommentSelectionOffsets,
    setCommentSelectionAtOffsets,
    type SelectionOffsets,
} from '@/pages/detail/comment/commentEditorSelection';

const COMMENT_EDITOR_CONFIG: InitialConfigType = {
    namespace: 'point-comments',
    nodes: [CommentEmojiNode, LinkNode],
    theme: {
        text: {
            italic: styles.commentEditorItalic,
            underline: styles.commentEditorUnderline,
            strikethrough: styles.commentEditorStrikethrough,
            underlineStrikethrough: styles.commentEditorUnderlineStrikethrough,
        },
    },
    onError: (error) => {
        throw error;
    },
};

const EDITOR_MAX_LENGTH = 550;
const CONTROLLED_VALUE_TAG = 'comment-controlled-value';

export type CommentEditorHandle = {
    focus: () => void;
    focusEnd: () => void;
    insertEmoji: (id: string) => void;
    formatText: (format: TextFormatType | 'spoiler') => void;
};

type Props = {
    value: string;
    maxLength: number;
    placeholder: string;
    disabled: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
    editorElementRef: React.RefObject<HTMLDivElement | null>;
    onEditorReady: () => void;
};

const getTextToInsert = (payload: string | InputEvent): string => {
    if (typeof payload === 'string') return payload;
    const transferred = payload.dataTransfer?.getData('text/plain');
    return transferred ?? payload.data ?? '';
};

const getInsertionUnitLength = (source: string, offset: number): number => {
    const emoji = /^:sns_(\d{3}):/.exec(source.slice(offset));
    if (emoji && getCommentEmojiUrl(emoji[1])) return emoji[0].length;
    return source.codePointAt(offset)! > 0xffff ? 2 : 1;
};

const clampCommentInsertion = (
    raw: string,
    selectionOffsets: SelectionOffsets | null,
    incoming: string,
    maxLength: number,
): string => {
    if (!incoming) return '';
    const start = Math.min(selectionOffsets?.anchor ?? raw.length, selectionOffsets?.focus ?? raw.length);
    const end = Math.max(selectionOffsets?.anchor ?? raw.length, selectionOffsets?.focus ?? raw.length);
    const before = raw.slice(0, start);
    const after = raw.slice(end);
    let result = '';
    for (let offset = 0; offset < incoming.length;) {
        const unitLength = getInsertionUnitLength(incoming, offset);
        const next = incoming.slice(offset, offset + unitLength);
        const candidate = `${before}${result}${next}${after}`;
        if (getCommentLength(candidate) > maxLength) break;
        result += next;
        offset += unitLength;
    }
    return result;
};

const serializeCommentEditorState = (
    editorState: Parameters<NonNullable<React.ComponentProps<typeof OnChangePlugin>['onChange']>>[0],
): string => editorState.read(() => serializeCommentNode($getRoot()));

const replaceCommentEditorContents = (
    raw: string,
    selectionOffsets: SelectionOffsets | null,
): void => {
    const root = $getRoot();
    const paragraph = $createParagraphNode();
    paragraph.append(...createCommentSourceNodes(raw, $createCommentEmojiNode));
    root.clear();
    root.append(paragraph);

    if (selectionOffsets) {
        setCommentSelectionAtOffsets($getSelection(), selectionOffsets.anchor, selectionOffsets.focus);
    } else {
        root.selectEnd();
    }
};

const markerByFormat: Partial<Record<TextFormatType | 'spoiler', string>> = {
    bold: '**',
    italic: '*',
    underline: '__',
    strikethrough: '~~',
    code: '`',
    spoiler: '||',
};

const isWrappedByMarker = (raw: string, start: number, end: number, marker: string): boolean => {
    if (start < marker.length || end + marker.length > raw.length) return false;
    if (!raw.slice(0, start).endsWith(marker) || !raw.slice(end).startsWith(marker)) return false;
    if (marker === '*') {
        if (raw[start - marker.length - 1] === '*' || raw[end + marker.length] === '*') return false;
    }
    return true;
};

const formatCommentSelection = (format: TextFormatType | 'spoiler'): void => {
    const marker = markerByFormat[format];
    if (!marker) return;

    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const raw = getCommentRawText();
    const offsets = getCommentSelectionOffsets(selection);
    if (!offsets) return;

    const start = Math.min(offsets.anchor, offsets.focus);
    const end = Math.max(offsets.anchor, offsets.focus);
    const wrapped = isWrappedByMarker(raw, start, end, marker);
    const nextRaw = wrapped
        ? `${raw.slice(0, start - marker.length)}${raw.slice(start, end)}${raw.slice(end + marker.length)}`
        : `${raw.slice(0, start)}${marker}${raw.slice(start, end)}${marker}${raw.slice(end)}`;
    const delta = wrapped ? -marker.length : marker.length;
    const moveSelectionOffset = (offset: number): number => (
        offset >= start ? offset + delta : offset
    );
    const nextOffsets = {
        anchor: moveSelectionOffset(offsets.anchor),
        focus: moveSelectionOffset(offsets.focus),
    };

    if (getCommentLength(nextRaw) > EDITOR_MAX_LENGTH) return;
    replaceCommentEditorContents(nextRaw, nextOffsets);
};

const CommentEditorBridge = ({
    value,
    maxLength,
    disabled,
    onChange,
    onSubmit,
    forwardedRef,
}: Pick<Props, 'value' | 'maxLength' | 'disabled' | 'onChange' | 'onSubmit'> & {
    forwardedRef: Ref<CommentEditorHandle>;
}) => {
    const [editor] = useLexicalComposerContext();
    const lastEmittedRawRef = useRef<string | null>(null);
    const lastParsedRawRef = useRef<string | null>(null);
    const parseScheduledRef = useRef(false);
    const pendingSourceRawRef = useRef<string | null>(null);
    const pendingValueRef = useRef<string | null>(null);
    const isComposingRef = useRef(false);
    const compositionStartValueRef = useRef<string | null>(null);
    const compositionSyncPendingRef = useRef(false);
    const controlledValueRef = useRef(value);
    controlledValueRef.current = value;

    const scheduleSourceParse = useCallback((raw: string) => {
        pendingSourceRawRef.current = raw;
        if (isComposingRef.current) return;
        if (parseScheduledRef.current) return;
        parseScheduledRef.current = true;
        queueMicrotask(() => {
            parseScheduledRef.current = false;
            const nextRaw = pendingSourceRawRef.current;
            pendingSourceRawRef.current = null;
            if (!nextRaw || nextRaw === lastParsedRawRef.current) return;
            const sourceShape = commentSourceShape(nextRaw);
            if (!sourceShape.includes('format:') && !sourceShape.includes('link:') && !sourceShape.includes('emoji:')) return;
            lastParsedRawRef.current = nextRaw;
            editor.update(() => {
                const selectionOffsets = getCommentSelectionOffsets($getSelection());
                replaceCommentEditorContents(nextRaw, selectionOffsets);
            }, { tag: [HISTORY_MERGE_TAG, SKIP_SCROLL_INTO_VIEW_TAG] });
        });
    }, [editor]);

    useLayoutEffect(() => {
        editor.setEditable(!disabled);
    }, [disabled, editor]);

    useLayoutEffect(() => {
        const currentValue = serializeCommentEditorState(editor.getEditorState());
        const nextValue = clampCommentInsertion('', null, value, EDITOR_MAX_LENGTH);
        if (isComposingRef.current) {
            // Parent state echoes editor changes through `value`. Keep those
            // updates inside Lexical; only defer a value that differs from the
            // last value emitted by this editor as a real external update.
            if (
                value !== currentValue
                && value !== lastEmittedRawRef.current
                && value !== compositionStartValueRef.current
            ) {
                pendingValueRef.current = value;
            }
            return;
        }
        if (compositionSyncPendingRef.current) {
            if (value === currentValue || value === lastEmittedRawRef.current) {
                compositionSyncPendingRef.current = false;
                return;
            }
            // The old controlled prop can render once after compositionend.
            // Lexical already owns the newer value, so wait for its echo.
            if (currentValue === lastEmittedRawRef.current) return;
            compositionSyncPendingRef.current = false;
        }
        if (currentValue === nextValue || lastEmittedRawRef.current === nextValue) return;
        lastEmittedRawRef.current = nextValue;
        lastParsedRawRef.current = nextValue;
        editor.update(() => replaceCommentEditorContents(nextValue, null), {
            // Commit external clears/restores before a later value can arrive.
            // Echoing this update to the owner can otherwise overwrite a draft
            // restored after an immediately rejected submission.
            tag: [SKIP_SCROLL_INTO_VIEW_TAG, CONTROLLED_VALUE_TAG],
            discrete: true,
        });
    }, [editor, value]);

    useEffect(() => {
        const root = editor.getRootElement();
        if (!root) return undefined;
        const handleCompositionStart = () => {
            isComposingRef.current = true;
            pendingValueRef.current = null;
            compositionStartValueRef.current = controlledValueRef.current;
            compositionSyncPendingRef.current = true;
        };
        const handleCompositionEnd = () => {
            isComposingRef.current = false;
            const pendingValue = pendingValueRef.current;
            pendingValueRef.current = null;
            if (pendingValue !== null) {
                compositionSyncPendingRef.current = false;
                const nextValue = clampCommentInsertion('', null, pendingValue, EDITOR_MAX_LENGTH);
                lastEmittedRawRef.current = nextValue;
                lastParsedRawRef.current = nextValue;
                editor.update(() => {
                    const selectionOffsets = getCommentSelectionOffsets($getSelection());
                    replaceCommentEditorContents(nextValue, selectionOffsets);
                }, {
                    tag: SKIP_SCROLL_INTO_VIEW_TAG,
                });
                return;
            }
            scheduleSourceParse(serializeCommentEditorState(editor.getEditorState()));
        };
        root.addEventListener('compositionstart', handleCompositionStart);
        root.addEventListener('compositionend', handleCompositionEnd);
        return () => {
            root.removeEventListener('compositionstart', handleCompositionStart);
            root.removeEventListener('compositionend', handleCompositionEnd);
        };
    }, [editor, scheduleSourceParse]);

    useEffect(() => editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
            if (disabled || (!event.ctrlKey && !event.metaKey) || event.altKey) return false;
            const shortcut = event.key.toLowerCase();
            const format = shortcut === 'b'
                ? 'bold'
                : shortcut === 'i'
                    ? 'italic'
                    : shortcut === 'u'
                        ? 'underline'
                        : null;
            if (!format) return false;
            event.preventDefault();
            editor.update(() => formatCommentSelection(format));
            lastParsedRawRef.current = serializeCommentEditorState(editor.getEditorState());
            editor.focus();
            return true;
        },
        COMMAND_PRIORITY_HIGH,
    ), [disabled, editor]);

    useEffect(() => editor.registerCommand(
        CONTROLLED_TEXT_INSERTION_COMMAND,
        (payload) => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return false;
            const incoming = getTextToInsert(payload).replace(/\r\n?/g, '\n');
            if (!incoming) return false;

            if (typeof payload !== 'string') payload.preventDefault();
            $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
            const limited = clampCommentInsertion(
                getCommentRawText(),
                getCommentSelectionOffsets(selection),
                incoming,
                EDITOR_MAX_LENGTH,
            );
            if (limited) selection.insertRawText(limited);
            return true;
        },
        COMMAND_PRIORITY_HIGH,
    ), [editor]);

    useEffect(() => editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection) || !event) return false;
            const dataTransfer = 'clipboardData' in event
                ? event.clipboardData
                : 'dataTransfer' in event
                    ? event.dataTransfer
                    : null;
            if (!dataTransfer) return false;
            event.preventDefault();
            $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
            const incoming = dataTransfer.getData('text/plain').replace(/\r\n?/g, '\n');
            if (incoming) {
                const limited = clampCommentInsertion(
                    getCommentRawText(),
                    getCommentSelectionOffsets(selection),
                    incoming,
                    EDITOR_MAX_LENGTH,
                );
                if (limited) {
                    if (limited.includes('\n') || limited.includes('\t')) selection.insertRawText(limited);
                    else selection.insertText(limited);
                    const nextRaw = getCommentRawText();
                    const nextSelection = getCommentSelectionOffsets($getSelection());
                    lastParsedRawRef.current = nextRaw;
                    replaceCommentEditorContents(nextRaw, nextSelection);
                }
            }
            return true;
        },
        COMMAND_PRIORITY_HIGH,
    ), [editor]);

    useEffect(() => editor.registerCommand(
        INSERT_LINE_BREAK_COMMAND,
        (selectStart) => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return false;
            $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
            const limited = clampCommentInsertion(
                getCommentRawText(),
                getCommentSelectionOffsets(selection),
                '\n',
                EDITOR_MAX_LENGTH,
            );
            if (limited) selection.insertLineBreak(selectStart);
            return true;
        },
        COMMAND_PRIORITY_HIGH,
    ), [editor]);

    useEffect(() => editor.registerCommand(
        INSERT_PARAGRAPH_COMMAND,
        () => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return false;
            $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
            const limited = clampCommentInsertion(
                getCommentRawText(),
                getCommentSelectionOffsets(selection),
                '\n',
                EDITOR_MAX_LENGTH,
            );
            if (limited) selection.insertLineBreak();
            return true;
        },
        COMMAND_PRIORITY_HIGH,
    ), [editor]);

    useEffect(() => editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
            if (!event || event.shiftKey || event.isComposing) return false;
            event.preventDefault();
            if (getCommentLength(getCommentRawText()) <= maxLength) onSubmit();
            return true;
        },
        COMMAND_PRIORITY_HIGH,
    ), [editor, maxLength, onSubmit]);

    useImperativeHandle(forwardedRef, () => ({
        focus: () => editor.focus(),
        focusEnd: () => {
            editor.update(() => $getRoot().selectEnd());
            editor.focus();
        },
        insertEmoji: (id) => {
            if (!getCommentEmojiUrl(id) || disabled) return;
            editor.update(() => {
                let selection = $getSelection();
                if (!$isRangeSelection(selection)) {
                    $getRoot().selectEnd();
                    selection = $getSelection();
                }
                if (!$isRangeSelection(selection)) return;
                const token = commentEmojiToken(id);
                const limited = clampCommentInsertion(
                    getCommentRawText(),
                    getCommentSelectionOffsets(selection),
                    token,
                    EDITOR_MAX_LENGTH,
                );
                if (limited !== token) return;

                const emojiNode = $createCommentEmojiNode(id);
                selection.insertNodes([emojiNode]);
                const parent = emojiNode.getParent();
                if (parent && $isElementNode(parent)) {
                    const nextOffset = emojiNode.getIndexWithinParent() + 1;
                    parent.select(nextOffset, nextOffset);
                }
            });
            editor.focus();
        },
        formatText: (format) => {
            if (disabled) return;
            editor.update(() => formatCommentSelection(format));
            lastParsedRawRef.current = serializeCommentEditorState(editor.getEditorState());
            editor.focus();
        },
    }), [disabled, editor]);

    return (
        <>
            <CommentEditorToolbar disabled={disabled} onFormat={formatCommentSelection} />
            <CommentEditorOverflow maxLength={maxLength} />
            <OnChangePlugin
                ignoreHistoryMergeTagChange={false}
                onChange={(editorState, _editor, tags) => {
                    if (tags.has(CONTROLLED_VALUE_TAG)) return;
                    const raw = serializeCommentEditorState(editorState);
                    lastEmittedRawRef.current = raw;
                    onChange(raw);
                    scheduleSourceParse(raw);
                }}
            />
        </>
    );
};

const CommentEditor = forwardRef<CommentEditorHandle, Props>(({
    value,
    maxLength,
    placeholder,
    disabled,
    onChange,
    onSubmit,
    onKeyDown,
    editorElementRef,
    onEditorReady,
}, ref) => {
    useLayoutEffect(onEditorReady, [onEditorReady]);

    return (
        <LexicalComposer initialConfig={COMMENT_EDITOR_CONFIG}>
            <div className={styles.commentEditorShell}>
                <RichTextPlugin
                    contentEditable={(
                        <ContentEditable
                            ref={editorElementRef}
                            className={styles.commentInput}
                            aria-label={placeholder}
                            aria-placeholder={placeholder}
                            placeholder={(
                                <span className={styles.commentInputPlaceholder}>
                                    {placeholder}
                                </span>
                            )}
                            aria-multiline="true"
                            spellCheck
                            autoCapitalize="sentences"
                            autoCorrect="on"
                            onKeyDown={onKeyDown}
                        />
                    )}
                    ErrorBoundary={LexicalErrorBoundary}
                />
            </div>
            <HistoryPlugin />
            <CommentEditorBridge
                value={value}
                maxLength={maxLength}
                disabled={disabled}
                onChange={onChange}
                onSubmit={onSubmit}
                forwardedRef={ref}
            />
        </LexicalComposer>
    );
});

CommentEditor.displayName = 'CommentEditor';

export default CommentEditor;

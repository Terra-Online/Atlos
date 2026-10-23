import { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { $getSelection, $isRangeSelection, $setSelection, type RangeSelection, type TextFormatType } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import Bold from '@/assets/images/UI/format/bold.svg';
import Italic from '@/assets/images/UI/format/italic.svg';
import Underline from '@/assets/images/UI/format/underline.svg';
import Strikethrough from '@/assets/images/UI/format/strike.svg';
import Code from '@/assets/images/UI/format/code.svg';
import ActionBar from '@/component/actionBar/ActionBar';
import HideUI from '@/assets/logos/hideUI.svg';
import styles from '@/pages/detail/comment/comments.module.scss';

type Format = TextFormatType | 'spoiler';
const actions: { format: Format; label: string; icon: string }[] = [
    { format: 'bold', label: 'Bold', icon: Bold },
    { format: 'italic', label: 'Italic', icon: Italic },
    { format: 'underline', label: 'Underline', icon: Underline },
    { format: 'strikethrough', label: 'Strikethrough', icon: Strikethrough },
    { format: 'code', label: 'Code', icon: Code },
    { format: 'spoiler', label: 'Spoiler', icon: HideUI },
];

const renderIcon = (src: string) => <img src={src} alt="" aria-hidden="true" />;

const CommentEditorToolbar = ({ disabled, onFormat }: {
    disabled: boolean;
    onFormat: (format: Format) => void;
}) => {
    const [editor] = useLexicalComposerContext();
    const selectionRef = useRef<RangeSelection | null>(null);
    const dismissedRef = useRef(false);
    const [anchor, setAnchor] = useState<DOMRect | null>(null);
    const open = Boolean(anchor) && !disabled;

    const update = useCallback(() => {
        const root = editor.getRootElement();
        const selection = window.getSelection();
        if (disabled || dismissedRef.current || editor.isComposing() || !root || !selection?.rangeCount
            || selection.isCollapsed || (!root.contains(document.activeElement)
                && !document.activeElement?.closest(`.${styles.commentFormatActions}`)) || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
            if (!document.activeElement?.closest(`.${styles.commentFormatActions}`)) setAnchor(null);
            return;
        }
        editor.getEditorState().read(() => {
            const range = $getSelection();
            if (!$isRangeSelection(range) || range.isCollapsed()) {
                setAnchor(null);
                return;
            }
            selectionRef.current = range.clone();
            const domRange = selection.getRangeAt(0);
            setAnchor(typeof domRange.getBoundingClientRect === 'function'
                ? domRange.getBoundingClientRect()
                : new DOMRect());
        });
    }, [disabled, editor]);

    useEffect(() => {
        let frame = 0;
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(update);
        };
        const selectionChanged = () => { dismissedRef.current = false; schedule(); };
        document.addEventListener('selectionchange', selectionChanged);
        document.addEventListener('pointerup', selectionChanged);
        window.addEventListener('resize', schedule);
        document.addEventListener('scroll', schedule, true);
        const unregister = editor.registerUpdateListener(schedule);
        return () => {
            cancelAnimationFrame(frame);
            unregister();
            document.removeEventListener('selectionchange', selectionChanged);
            document.removeEventListener('pointerup', selectionChanged);
            window.removeEventListener('resize', schedule);
            document.removeEventListener('scroll', schedule, true);
        };
    }, [editor, update]);

    const dismiss = useCallback(() => {
        dismissedRef.current = true;
        setAnchor(null);
    }, []);

    return (
        <ActionBar
            variant="floating"
            className={classNames(styles.commentActions, styles.commentFormatActions)}
            ariaLabel="Text formatting"
            anchorRect={open ? anchor : null}
            onFloatingDismiss={dismiss}
            items={actions.map(({ format, label, icon: Icon }) => ({
                id: format,
                label,
                icon: renderIcon(Icon),
                disabled: !open,
                onClick: () => {
                    const selection = selectionRef.current;
                    if (!selection) return;
                    editor.update(() => {
                        $setSelection(selection.clone());
                        onFormat(format);
                    });
                    editor.focus();
                },
            }))}
        />
    );
};

export default CommentEditorToolbar;

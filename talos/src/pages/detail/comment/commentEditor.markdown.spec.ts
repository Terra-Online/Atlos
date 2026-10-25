import React, { createElement, createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CommentEditor, { type CommentEditorHandle } from '@/pages/detail/comment/commentEditor';

afterEach(cleanup);

vi.mock('@/assets/logos/hideUI.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/format/bold.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/format/italic.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/format/underline.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/format/strike.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/format/code.svg?react', () => ({ default: () => null }));

if (!Range.prototype.getBoundingClientRect) {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => new DOMRect(0, 0, 0, 0),
    });
}

const renderEditor = (props: Partial<React.ComponentProps<typeof CommentEditor>> = {}) => {
    const ref = createRef<CommentEditorHandle>();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const onEditorReady = vi.fn();
    render(createElement(CommentEditor, {
        ref,
        editorElementRef: createRef<HTMLDivElement>(),
        value: '',
        maxLength: 500,
        placeholder: 'Comment',
        disabled: false,
        onChange,
        onSubmit,
        onKeyDown: vi.fn(),
        onEditorReady,
        ...props,
    }));
    return { ref, onChange, onSubmit, onEditorReady };
};

it.each([
    ['bold', '**', 'strong'],
    ['italic', '*', 'em'],
    ['underline', '__', '[class*="commentEditorUnderline"]'],
    ['strikethrough', '~~', '[class*="commentEditorStrikethrough"]'],
    ['code', '`', 'code'],
] as const)('formats a selected range as %s Markdown', async (format, marker, selector) => {
    const { ref, onChange, onEditorReady } = renderEditor({ value: 'bold' });
    const editor = await screen.findByRole('textbox');
    const textNode = editor.querySelector('[data-lexical-text]')?.firstChild;
    if (!textNode) throw new Error('Editor text node was not rendered');
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    act(() => ref.current?.formatText(format));

    expect(onEditorReady).toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(`${marker}bold${marker}`));
    const formatted = editor.querySelector(selector);
    expect(formatted?.textContent ?? editor.textContent).toBe(
        formatted ? 'bold' : `${marker}bold${marker}`,
    );
});

it('renders existing Markdown as editable formatted nodes', async () => {
    renderEditor({
        value: '**bold** *italic* ***bold italic*** __underline__ ~~strike~~ `code` [link](https://example.com)',
    });
    const editor = await screen.findByRole('textbox');
    expect(editor.querySelector('strong')?.textContent).toBe('bold');
    expect(editor.querySelector('em')?.textContent).toBe('italic');
    expect([...editor.querySelectorAll('[class*="commentEditorItalic"]')]
        .some((node) => node.textContent === 'bold italic')).toBe(true);
    expect(editor.querySelector('[class*="commentEditorUnderline"]')?.textContent).toBe('underline');
    expect(editor.querySelector('[class*="commentEditorStrikethrough"]')?.textContent).toBe('strike');
    expect(editor.querySelector('code')?.textContent).toBe('code');
    expect(editor.querySelector('a[href="https://example.com"]')?.textContent).toBe('link');
});

it.each([
    ['b', 'strong'],
    ['i', 'em'],
    ['u', '[class*="commentEditorUnderline"]'],
] as const)('applies the Ctrl+%s shortcut to the selected text', async (key, selector) => {
    renderEditor({ value: 'text' });
    const editor = await screen.findByRole('textbox');
    const textNode = editor.querySelector('[data-lexical-text]')?.firstChild;
    if (!textNode) throw new Error('Editor text node was not rendered');
    editor.focus();

    const range = document.createRange();
    range.selectNodeContents(textNode);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    fireEvent.keyDown(editor, { key, ctrlKey: true });

    await waitFor(() => expect(editor.querySelector(selector)?.textContent).toBe('text'));
});

it('combines bold and italic shortcuts and keeps both styles in Markdown', async () => {
    const { onChange } = renderEditor({ value: 'text' });
    const editor = await screen.findByRole('textbox');
    const textNode = editor.querySelector('[data-lexical-text]')?.firstChild;
    if (!textNode) throw new Error('Editor text node was not rendered');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event('selectionchange'));

    fireEvent.keyDown(editor, { key: 'b', ctrlKey: true });
    fireEvent.keyDown(editor, { key: 'i', ctrlKey: true });

    await waitFor(() => {
        expect(editor.querySelector('strong')?.textContent).toBe('text');
        expect(editor.querySelector('[class*="commentEditorItalic"]')?.textContent).toBe('text');
        expect(onChange).toHaveBeenLastCalledWith('***text***');
    });
});

it('keeps Markdown tokens visible while the caret edits a formatted range', async () => {
    const { onChange } = renderEditor({ value: '**bold**' });
    const editor = await screen.findByRole('textbox');
    const textNode = editor.querySelector('strong[data-lexical-text]')?.firstChild;
    if (!textNode) throw new Error('Editor text node was not rendered');
    editor.focus();

    const range = document.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event('selectionchange'));

    await waitFor(() => {
        expect(editor.querySelector('strong')?.textContent).toBe('bold');
        expect(editor.querySelector('[data-lexical-text]')?.getAttribute('style')).toContain('opacity');
        expect(editor.textContent).toBe('**bold**');
    });
    expect(onChange).toHaveBeenLastCalledWith('**bold**');
});

it('does not move the caret when entering a formatted range', async () => {
    renderEditor({ value: '**ab**' });
    const editor = await screen.findByRole('textbox');
    const textNode = editor.querySelector('strong[data-lexical-text]')?.firstChild;
    if (!textNode) throw new Error('Editor text node was not rendered');
    editor.focus();

    const range = document.createRange();
    range.setStart(textNode, 1);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event('selectionchange'));

    await waitFor(() => {
        expect(editor.textContent).toBe('**ab**');
        expect(editor.querySelector('strong')?.textContent).toBe('ab');
    });
});

it('keeps a single formatted character editable with visible tokens', async () => {
    renderEditor({ value: '**x**' });
    const editor = await screen.findByRole('textbox');
    const textNode = editor.querySelector('strong[data-lexical-text]')?.firstChild;
    if (!textNode) throw new Error('Editor text node was not rendered');
    editor.focus();

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event('selectionchange'));

    await waitFor(() => {
        expect(editor.textContent).toBe('**x**');
        expect(editor.querySelector('strong')?.textContent).toBe('x');
    });
});

it('keeps the caret inside a formatted range across a controlled IME update', async () => {
    const ControlledEditor = () => {
        const [value, setValue] = React.useState('**ab**');
        return createElement(CommentEditor, {
            editorElementRef: createRef<HTMLDivElement>(),
            value,
            maxLength: 500,
            placeholder: 'Comment',
            disabled: false,
            onChange: setValue,
            onSubmit: vi.fn(),
            onKeyDown: vi.fn(),
            onEditorReady: vi.fn(),
        });
    };

    render(createElement(ControlledEditor));
    const editor = await screen.findByRole('textbox');
    const textNode = editor.querySelector('strong[data-lexical-text]')?.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) throw new Error('Formatted text node missing');

    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    editor.focus();

    fireEvent.compositionStart(editor);
    textNode.nodeValue = 'a中b';
    fireEvent.input(editor, { inputType: 'insertCompositionText', data: '中' });
    fireEvent.compositionEnd(editor, { data: '中' });

    await waitFor(() => expect(editor.textContent).toBe('**a中b**'));
    expect(window.getSelection()?.anchorNode?.parentElement?.closest('strong')).toBeTruthy();
});

it('keeps link source syntax visible while preserving the link effect', async () => {
    renderEditor({ value: '[link](https://example.com)' });
    const editor = await screen.findByRole('textbox');
    const textNode = editor.querySelector('a [data-lexical-text]')?.firstChild;
    if (!textNode) throw new Error('Link text node was not rendered');
    editor.focus();

    const range = document.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event('selectionchange'));

    await waitFor(() => {
        expect(editor.querySelector('a')?.textContent).toBe('link');
        expect(editor.textContent).toBe('[link](https://example.com)');
    });
});

it('places an emoji node at the editor selection and serializes its token', async () => {
    const { ref, onChange } = renderEditor({ value: 'hello world' });
    const editor = await screen.findByRole('textbox');
    const textNode = editor.querySelector('[data-lexical-text]')?.firstChild;
    if (!textNode) throw new Error('Editor text node was not rendered');
    const range = document.createRange();
    range.setStart(textNode, 5);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    act(() => ref.current?.insertEmoji('001'));

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('hello:sns_001: world'));
    const paragraph = editor.querySelector('p');
    expect(paragraph?.childNodes[0]?.textContent).toBe('hello');
    expect(paragraph?.getElementsByTagName('img').item(0)?.alt).toBe(':sns_001:');
    expect(paragraph?.childNodes[2]?.textContent).toBe(' world');
    expect(window.getSelection()?.anchorNode).toBe(paragraph);
    expect(window.getSelection()?.anchorOffset).toBe(2);
});

it('submits on Enter and keeps Shift+Enter as a line break', async () => {
    const { ref, onChange, onSubmit } = renderEditor();
    const editor = await screen.findByRole('textbox');

    act(() => ref.current?.focus());
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('\n'));

    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('\n');
});

it('keeps emoji tokens editable beyond the limit and blocks submission', async () => {
    const { ref, onChange, onSubmit } = renderEditor({ value: ':sns_001:', maxLength: 3 });
    const editor = await screen.findByRole('textbox');
    expect(editor.querySelector('img[alt=":sns_001:"]')).toBeTruthy();

    act(() => ref.current?.focusEnd());
    act(() => ref.current?.insertEmoji('002'));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(':sns_001::sns_002:'));
    expect(editor.querySelector('img[alt=":sns_002:"]')).toBeTruthy();
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
});

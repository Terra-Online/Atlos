import { createElement, createRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CommentEditor, { type CommentEditorHandle } from '@/pages/detail/comment/commentEditor';

beforeEach(() => { vi.spyOn(window, 'scrollBy').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true, value: () => new DOMRect(50, 150, 80, 20),
});

const setup = (initial = '') => {
    const onSubmit = vi.fn();
    const ref = createRef<CommentEditorHandle>();
    const Harness = () => {
        const [value, onChange] = useState(initial);
        return createElement(CommentEditor, {
            ref, value, onChange, maxLength: 500, placeholder: 'Comment', disabled: false,
            editorElementRef: createRef<HTMLDivElement>(), onEditorReady: () => {},
            onKeyDown: () => {}, onSubmit,
        });
    };
    render(createElement(Harness));
    return { ref, onSubmit };
};

it('commits external clear and restore values without echoing them as stale user edits', async () => {
    const onChange = vi.fn();
    const props = { value: 'Restored draft', maxLength: 500, placeholder: 'Comment', disabled: false,
        onChange, onSubmit: () => {}, onKeyDown: () => {}, editorElementRef: createRef<HTMLDivElement>(), onEditorReady: () => {} };
    const view = render(createElement(CommentEditor, props));
    await waitFor(() => expect(screen.getByRole('textbox').textContent).toBe('Restored draft'));
    onChange.mockClear();
    view.rerender(createElement(CommentEditor, { ...props, value: '' }));
    expect(screen.getByRole('textbox').textContent).toBe('');
    view.rerender(createElement(CommentEditor, props));
    expect(screen.getByRole('textbox').textContent).toBe('Restored draft');
    await act(async () => { await Promise.resolve(); });
    expect(onChange).not.toHaveBeenCalled();
});

it('preserves an over-limit paste, shows the count, and allows submission after correction', async () => {
    const { ref, onSubmit } = setup();
    const input = screen.getByRole('textbox');
    act(() => ref.current?.focus());
    fireEvent.paste(input, { clipboardData: { getData: () => 'a'.repeat(501) } });
    await waitFor(() => expect(input.textContent).toBe('a'.repeat(501)));
    expect(input.lastElementChild?.getAttribute('data-comment-length')).toBe('(501/500)');
    expect(input.hasAttribute('data-over-limit')).toBe(true);
    input.removeAttribute('data-over-limit');
    input.lastElementChild?.removeAttribute('data-comment-length');
    await waitFor(() => {
        expect(input.hasAttribute('data-over-limit')).toBe(true);
        expect(input.lastElementChild?.getAttribute('data-comment-length')).toBe('(501/500)');
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    const range = document.createRange();
    const text = input.querySelector('[data-lexical-text]')!.firstChild!;
    range.setStart(text, 499);
    range.setEnd(text, 501);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    fireEvent.paste(input, { clipboardData: { getData: () => 'a' } });
    await waitFor(() => expect(input.textContent).toHaveLength(500));
    expect(input.lastElementChild?.getAttribute('data-comment-length')).toBe('(500/500)');
    expect(input.hasAttribute('data-over-limit')).toBe(false);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
});

it('caps editor input at 550 while keeping the 500-character submit limit', async () => {
    const { ref, onSubmit } = setup('a'.repeat(600));
    const input = screen.getByRole('textbox');
    await waitFor(() => expect(input.textContent).toHaveLength(550));
    expect(input.lastElementChild?.getAttribute('data-comment-length')).toBe('(550/500)');
    expect(input.hasAttribute('data-over-limit')).toBe(true);
    act(() => ref.current?.focus());
    fireEvent.paste(input, { clipboardData: { getData: () => 'b' } });
    await waitFor(() => expect(input.textContent).toHaveLength(550));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
});

it('highlights only the overflow range across formatted source without rewriting it', async () => {
    const highlights = new Map();
    class TestHighlight { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } }
    vi.stubGlobal('CSS', { highlights });
    vi.stubGlobal('Highlight', TestHighlight);
    const content = `${'a'.repeat(497)}**bold**`;
    setup(content);
    await waitFor(() => expect(screen.getByRole('textbox').textContent).toBe(content));
    const ranges = [...highlights.values()].flatMap((highlight: TestHighlight) => highlight.ranges);
    expect(ranges.map((range: Range) => range.toString()).join('')).toBe('old**');
    expect(screen.getByRole('textbox').querySelector('strong')?.textContent).toBe('bold');
});

it('formats the saved selection from the floating toolbar and dismisses on Escape', async () => {
    setup('selected text');
    const input = screen.getByRole('textbox');
    await waitFor(() => expect(input.textContent).toBe('selected text'));
    input.focus();
    const text = input.querySelector('[data-lexical-text]')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 8);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    const toolbar = await screen.findByRole('toolbar', { name: 'Text formatting' });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Spoiler' }));
    fireEvent.click(screen.getByRole('button', { name: 'Spoiler' }));
    await waitFor(() => expect(input.textContent).toBe('||selected|| text'));
    expect(window.getSelection()?.toString()).toBe('selected');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toolbar.getAttribute('aria-hidden')).toBe('true');
});

it('counts each custom emoji as two characters for the limit, highlighting and submission', async () => {
    const { ref, onSubmit } = setup(`${'a'.repeat(498)}:sns_001:`);
    const input = screen.getByRole('textbox');
    await waitFor(() => expect(input.querySelector('img')).toBeTruthy());
    expect(input.lastElementChild?.getAttribute('data-comment-length')).toBe('(500/500)');
    expect(input.hasAttribute('data-over-limit')).toBe(false);
    act(() => ref.current?.focusEnd());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
    act(() => ref.current?.insertEmoji('002'));
    await waitFor(() => expect(input.lastElementChild?.getAttribute('data-comment-length')).toBe('(502/500)'));
    expect(input.hasAttribute('data-over-limit')).toBe(true);
    expect(input.querySelector('span[data-over-limit] img')?.getAttribute('alt')).toBe(':sns_002:');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
});

it.each([
    ['underline', '__s__', '[class*="commentEditorUnderline"]'],
    ['strikethrough', '~~s~~', '[class*="commentEditorStrikethrough"]'],
    ['spoiler', '||s||', '[style*="background-color"]'],
] as const)('keeps %s styling when text changes inside an existing format', async (_format, source, selector) => {
    setup(source);
    const input = screen.getByRole('textbox');
    const formatted = await waitFor(() => {
        const node = input.querySelector(selector)?.firstChild;
        if (!(node instanceof Text)) throw new Error('Formatted text node was not rendered');
        return node;
    });
    const range = document.createRange();
    range.setStart(formatted, formatted.length);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    fireEvent.paste(input, { clipboardData: { getData: () => 'asdad' } });

    await waitFor(() => {
        const styled = input.querySelector(selector);
        expect(styled?.textContent).toBe('sasdad');
    });
});

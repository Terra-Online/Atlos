import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CommentEditor, { type CommentEditorHandle } from '@/pages/detail/comment/commentEditor';
import { CommentContent } from '@/component/shared/comments/CommentContent';
import { parseCommentContent, parseCommentSource } from '@/component/shared/comments/commentMarkdown';

vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('parses multiline spoilers with formatting, links and emoji while preserving editor source', () => {
    const content = '||first **bold**\n[link](https://example.com) :sns_001:||';
    const nodes = parseCommentContent(content);
    expect(nodes).toMatchObject([{
        type: 'format', format: 'spoiler', children: [
            'first ', { type: 'format', format: 'bold', children: ['bold'] }, '\n',
            { type: 'link', href: 'https://example.com' }, ' ', { type: 'emoji', id: '001' },
        ],
    }]);
    expect(parseCommentSource(content)).toMatchObject([{
        type: 'format', format: 'spoiler', opening: '||', closing: '||',
    }]);
    expect(parseCommentContent('\\||visible\\|| `||code||` ||unfinished')).toEqual([
        '||visible|| ', { type: 'format', format: 'code', children: ['||code||'] }, ' ||unfinished',
    ]);
});

it('reveals a whole multiline spoiler on click and resets when its content changes', () => {
    const { rerender } = render(<p><CommentContent content={'||first\n**[second](https://example.com)** :sns_001:||'} /></p>);
    const spoiler = screen.getByRole('button', { name: 'Spoiler' });
    expect(spoiler.getAttribute('aria-expanded')).toBe('false');
    expect(spoiler.querySelector('[inert]')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(spoiler);
    expect(spoiler.getAttribute('aria-expanded')).toBe('true');
    expect(spoiler.getAttribute('aria-label')).toBe('Spoiler');
    expect(spoiler.textContent).toBe('first\nsecond ');
    expect(spoiler.querySelector('strong')?.textContent).toBe('second');
    expect(screen.getByRole('img', { name: ':sns_001:' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'second' }).getAttribute('href')).toBe('https://example.com');
    fireEvent.click(spoiler);
    expect(spoiler.getAttribute('aria-expanded')).toBe('true');
    rerender(<p><CommentContent content="||new spoiler||" /></p>);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
});

it.each(['Enter', ' '])('reveals with %s and positions the tooltip above the first line', (key) => {
    render(<CommentContent content={'||first\nsecond||'} />);
    const spoiler = screen.getByRole('button');
    Object.defineProperty(spoiler, 'getClientRects', {
        value: () => [new DOMRect(100, 100, 80, 20), new DOMRect(100, 120, 160, 20)],
    });
    fireEvent.mouseEnter(spoiler);
    const tooltip = document.getElementById(spoiler.getAttribute('aria-describedby') ?? '');
    expect(tooltip?.dataset.placement).toBe('top');
    expect(tooltip?.style.left).toBe('140px');
    expect(tooltip?.style.bottom).toBe(`${window.innerHeight - 100 + 8}px`);
    expect(tooltip?.textContent).toBe('detail.comments.spoilerHidden');
    fireEvent.keyDown(spoiler, { key });
    expect(spoiler.getAttribute('aria-expanded')).toBe('true');
    expect(tooltip?.textContent).toBe('detail.comments.spoilerRevealed');
});

const mountEditor = (value: string, maxLength = 200) => {
    const ref = createRef<CommentEditorHandle>();
    const onChange = vi.fn();
    render(<CommentEditor ref={ref} value={value} maxLength={maxLength}
        placeholder="Comment" disabled={false} onChange={onChange} onSubmit={vi.fn()}
        onKeyDown={vi.fn()} editorElementRef={createRef<HTMLDivElement>()} onEditorReady={vi.fn()} />);
    return { ref, onChange };
};

const selectEditorText = (editor: HTMLElement) => {
    const texts = editor.querySelectorAll('[data-lexical-text]');
    const range = document.createRange();
    range.setStart(texts[0].firstChild!, 0);
    const last = texts[texts.length - 1].firstChild!;
    range.setEnd(last, last.textContent!.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
};

it('applies and removes spoiler markers around a multiline editor selection', async () => {
    const { ref, onChange } = mountEditor('first\nsecond');
    const editor = await screen.findByRole('textbox');
    selectEditorText(editor);
    act(() => ref.current?.formatText('spoiler'));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('||first\nsecond||'));
    expect(editor.querySelectorAll('[style*="background-color"]')).toHaveLength(2);
    act(() => ref.current?.formatText('spoiler'));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('first\nsecond'));
});

it('keeps spoilers editable with nested formats and honors the comment length limit', async () => {
    const { ref, onChange } = mountEditor('||**bold**\nsecond||', 20);
    const editor = await screen.findByRole('textbox');
    expect(editor.querySelector('strong')?.textContent).toBe('bold');
    expect(editor.textContent).toBe('||**bold**second||');
    selectEditorText(editor);
    act(() => ref.current?.formatText('spoiler'));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('||**bold**\nsecond||'));
});

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommentContent } from '@/component/shared/comments/CommentContent';
import { parseCommentContent, parseCommentSource } from '@/component/shared/comments/commentMarkdown';

vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key }));
afterEach(cleanup);

it('renders known tokens as images and leaves unknown tokens as text', () => {
    render(createElement('p', null, createElement(CommentContent, {
        content: 'before :sns_001:\nafter :sns_999:',
    })));

    expect(screen.getByRole('img', { name: ':sns_001:' })).toBeTruthy();
    expect(screen.getByText(/:sns_999:/)).toBeTruthy();
});

it('renders supported inline Markdown formats and nested formatting', () => {
    const { container } = render(createElement('p', null, createElement(CommentContent, {
        content: '**bold *italic*** __underline__ ~~strike~~ `code` [link](https://example.com)',
    })));

    expect(container.querySelector('strong')?.textContent).toBe('bold italic');
    expect(container.querySelector('em')?.textContent).toBe('italic');
    expect(container.querySelector('u')?.textContent).toBe('underline');
    expect(container.querySelector('s')?.textContent).toBe('strike');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(screen.getByRole('link', { name: 'link' }).getAttribute('href')).toBe('https://example.com');
    expect(screen.getByRole('link', { name: 'link' }).getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: 'link' }).getAttribute('rel')).toBe('noopener noreferrer nofollow');
});

it('keeps unknown tokens, unmatched formatting, and unsafe links as text', () => {
    const { container } = render(createElement('p', null, createElement(CommentContent, {
        content: ':sns_999: **unfinished [unsafe](javascript:alert(1))',
    })));

    expect(container.textContent).toContain(':sns_999:');
    expect(container.textContent).toContain('**unfinished');
    expect(container.querySelector('a')).toBeNull();
});

it('parses Markdown without interpreting HTML', () => {
    expect(parseCommentContent('<img src=x onerror=alert(1)>')).toEqual(['<img src=x onerror=alert(1)>']);
    const view = render(createElement(CommentContent, { content: '<script>alert(1)</script> <img src=x onerror=alert(1)>' }));
    expect(view.container.querySelector('script,img')).toBeNull();
    expect(view.container.textContent).toContain('<script>alert(1)</script>');
});

it('reveals independent spoilers without activating a hidden link on its first click', () => {
    const view = render(createElement(CommentContent, { content: '||[destination](https://example.test)|| ||second||' }));
    const [first, second] = screen.getAllByRole('button', { name: 'Spoiler' });
    const link = view.container.querySelector('a')!;
    const firstClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(link, firstClick);
    expect(firstClick.defaultPrevented).toBe(true);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(second.getAttribute('aria-expanded')).toBe('false');
    // Block browser navigation in the test while recording whether the revealed
    // spoiler itself continues to swallow the click.
    let alreadyPrevented = true;
    const stopNavigation = (event: MouseEvent) => { alreadyPrevented = event.defaultPrevented; event.preventDefault(); };
    view.container.addEventListener('click', stopNavigation);
    fireEvent.click(link);
    expect(alreadyPrevented).toBe(false);
    view.container.removeEventListener('click', stopNavigation);
});

it('keeps source markers while preserving nested formatting spans', () => {
    const nested = parseCommentSource('**bold *italic***');
    expect(nested).toEqual([
        {
            type: 'format',
            format: 'bold',
            opening: '**',
            closing: '**',
            children: [
                { type: 'text', value: 'bold ' },
                {
                    type: 'format',
                    format: 'italic',
                    opening: '*',
                    closing: '*',
                    children: [{ type: 'text', value: 'italic' }],
                },
            ],
        },
    ]);
    const adjacent = parseCommentSource('**重要***的事情');
    expect(adjacent[0]).toMatchObject({
        type: 'format',
        format: 'bold',
        children: [{ type: 'text', value: '重要' }],
    });
    expect(adjacent[1]).toEqual({ type: 'text', value: '*的事情' });
});

import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CommentContent } from '@/component/shared/comments/CommentContent';
import { parseCommentContent, parseCommentSource } from '@/component/shared/comments/commentMarkdown';

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

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PillButton, RoundIconButton, SquareButton } from './button';
import IconButton from './IconButton';
import { EntryButton } from './EntryButton';

afterEach(cleanup);

describe('styled buttons', () => {
    it('uses the written label as the accessible name for text buttons', () => {
        render(<form onSubmit={() => { throw new Error('submitted'); }}>
            <PillButton>Schließen</PillButton>
            <SquareButton>Export</SquareButton>
        </form>);
        for (const label of ['Schließen', 'Export']) {
            const button = screen.getByRole('button', { name: label });
            expect(button.textContent).toBe(label);
            expect(button.getAttribute('type')).toBe('button');
            fireEvent.click(button);
        }
    });

    it('gives icon-only controls an accessible name and native disabled behavior', () => {
        const onClick = vi.fn();
        const { rerender } = render(<RoundIconButton label="Back" icon="prev" disabled onClick={onClick} />);
        const button = screen.getByRole('button', { name: 'Back' });
        expect(button.textContent).toBe('');
        expect(button.getAttribute('type')).toBe('button');
        fireEvent.click(button);
        expect(onClick).not.toHaveBeenCalled();

        rerender(<RoundIconButton label="Back" icon="prev" onClick={onClick} />);
        fireEvent.click(button);
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('accepts native button attributes, refs, and caller layout styles', () => {
        const ref = createRef<HTMLButtonElement>();
        const onSubmit = vi.fn((event) => event.preventDefault());
        render(<form onSubmit={onSubmit}>
            <SquareButton ref={ref} type="submit" className="own" style={{ width: '100%' }}>
                Save
            </SquareButton>
        </form>);
        const button = screen.getByRole('button', { name: 'Save' });
        expect(ref.current).toBe(button);
        expect(button.classList.contains('own')).toBe(true);
        expect(button.style.width).toBe('100%');
        fireEvent.click(button);
        expect(onSubmit).toHaveBeenCalledOnce();
    });
});

describe('IconButton', () => {
    it('labels the button, reports pressed state only when given, and renders the icon before children', () => {
        const ref = createRef<HTMLButtonElement>();
        const { rerender } = render(<IconButton label="Pin" ref={ref} icon={<i data-testid="icon" />}>text</IconButton>);
        const button = screen.getByRole('button', { name: 'Pin' });
        expect(button).toBe(ref.current);
        expect(button.getAttribute('type')).toBe('button');
        expect(button.hasAttribute('aria-pressed')).toBe(false);
        expect(button.firstChild).toBe(screen.getByTestId('icon'));
        expect(button.textContent).toBe('text');

        rerender(<IconButton label="Pin" pressed className="own" />);
        expect(screen.getByRole('button', { name: 'Pin', pressed: true }).className).toBe('own');
        rerender(<IconButton label="Pin" pressed={false} type="submit" />);
        expect(screen.getByRole('button', { pressed: false }).getAttribute('type')).toBe('submit');
    });
});

describe('EntryButton', () => {
    it('renders the label and a platform icon slot only when an icon is given', () => {
        const onClick = vi.fn();
        const { rerender } = render(<EntryButton label="GitHub" platform="github" className="own" onClick={onClick}><svg data-testid="logo" /></EntryButton>);
        const button = screen.getByRole('button', { name: 'GitHub' });
        expect(button.getAttribute('type')).toBe('button');
        expect(button.className).toContain('own');
        expect(screen.getByTestId('logo').parentElement?.dataset.platform).toBe('github');
        fireEvent.click(button);
        expect(onClick).toHaveBeenCalledOnce();

        rerender(<EntryButton label="Email" platform="email" />);
        const inner = screen.getByRole('button', { name: 'Email' }).firstElementChild!;
        expect([...inner.children].map((child) => child.textContent)).toEqual(['Email']);
    });
});

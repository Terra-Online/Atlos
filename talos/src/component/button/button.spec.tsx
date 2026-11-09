import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Button from './button';
import IconButton from './IconButton';
import { EntryButton } from './EntryButton';
import styles from './button.module.scss';

afterEach(cleanup);

const cssVar = (element: HTMLElement, name: string) => element.style.getPropertyValue(name);

describe('Button', () => {
    it('renders a non-submitting normal close button with decoration, text and icon', () => {
        render(<form onSubmit={() => { throw new Error('submitted'); }}><Button text="Close" /></form>);
        const button = screen.getByRole('button', { name: 'Close' });
        expect(button.getAttribute('type')).toBe('button');
        expect(button.dataset).toMatchObject({ type: 'close', buttonStyle: 'normal', schema: 'light', deco: 'true' });
        expect(button.hasAttribute('aria-label')).toBe(false);
        expect(button.querySelector(`.${styles.deco}`)).not.toBeNull();
        expect(button.querySelector(`.${styles.text}`)?.textContent).toBe('Close');
        expect(button.querySelector(`.${styles.icon}`)).not.toBeNull();
        expect(cssVar(button, '--btn-width')).toBe('6rem');
        expect(cssVar(button, '--btn-height')).toBe('1.5rem');
        fireEvent.click(button);
    });

    it('names icon buttons from their text and sizes them as a square', () => {
        render(<Button text="Next" buttonStyle="icon" buttonType="next" size={32} width={200} />);
        const button = screen.getByRole('button', { name: 'Next' });
        expect(button.getAttribute('aria-label')).toBe('Next');
        expect(button.querySelector(`.${styles.text}`)).toBeNull();
        expect(button.querySelector(`.${styles.deco}`)).toBeNull();
        expect(button.querySelector(`.${styles.icon}`)).not.toBeNull();
        expect(cssVar(button, '--btn-width')).toBe('32px');
        expect(cssVar(button, '--btn-height')).toBe('32px');
    });

    it('prefers an explicit aria-label over the icon text', () => {
        render(<Button text="Next" buttonStyle="icon" aria-label="Go forward" />);
        expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Go forward');
    });

    it('enlarges square buttons only when the default size is kept', () => {
        const { rerender } = render(<Button text="Confirm" buttonStyle="square" buttonType="confirm" />);
        let button = screen.getByRole('button', { name: 'Confirm' });
        expect(cssVar(button, '--btn-width')).toBe('12rem');
        expect(cssVar(button, '--btn-height')).toBe('3rem');
        expect(button.querySelector(`.${styles.squareDeco}`)).not.toBeNull();
        expect(button.querySelector(`.${styles.icon}`)).toBeNull();
        expect(button.querySelector(`.${styles.deco}`)).toBeNull();

        rerender(<Button text="Confirm" buttonStyle="square" width={80} height="2rem" />);
        button = screen.getByRole('button', { name: 'Confirm' });
        expect(cssVar(button, '--btn-width')).toBe('80px');
        expect(cssVar(button, '--btn-height')).toBe('2rem');
    });

    it('drops only the normal-style decoration when deco is off', () => {
        render(<Button text="Prev" deco={false} schema="dark" buttonType="prev" />);
        const button = screen.getByRole('button', { name: 'Prev' });
        expect(button.dataset).toMatchObject({ deco: 'false', schema: 'dark', type: 'prev' });
        expect(button.querySelector(`.${styles.deco}`)).toBeNull();
        expect(button.querySelector(`.${styles.text}`)).not.toBeNull();
    });

    it('merges class names and lets caller styles override the size variables', () => {
        render(<Button text="Go" className="extra" style={{ ['--btn-width' as string]: '1px', color: 'red' }} />);
        const button = screen.getByRole('button', { name: 'Go' });
        expect(button.className).toBe(`${styles.button} extra`);
        expect(cssVar(button, '--btn-width')).toBe('1px');
        expect(cssVar(button, '--btn-height')).toBe('1.5rem');
        expect(button.style.color).toBe('red');
    });

    it('forwards the ref, native attributes and click handling, and blocks clicks when disabled', () => {
        const ref = createRef<HTMLButtonElement>();
        const onClick = vi.fn();
        const { rerender } = render(<Button text="Go" ref={ref} onClick={onClick} data-testid="go" type="submit" />);
        expect(ref.current).toBe(screen.getByTestId('go'));
        expect(ref.current?.getAttribute('type')).toBe('submit');
        fireEvent.click(ref.current!);
        expect(onClick).toHaveBeenCalledOnce();

        rerender(<Button text="Go" ref={ref} onClick={onClick} disabled />);
        fireEvent.click(ref.current!);
        expect(onClick).toHaveBeenCalledOnce();
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

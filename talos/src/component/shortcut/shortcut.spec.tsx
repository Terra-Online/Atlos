import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KeyCap, Shortcut } from '.';
import styles from './shortcut.module.scss';

const platform = vi.hoisted(() => ({ mac: false }));
vi.mock('@/platform/platform', () => ({ isMac: () => platform.mac }));
afterEach(() => { cleanup(); platform.mac = false; });

const caps = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(`.${styles.keyCap}`)]
    .map((cap) => [cap.textContent, cap.dataset.ch, cap.dataset.type]);

it('renders each chip in order with its width and input type', () => {
    const { container } = render(<Shortcut keys={[
        { label: '⇧', size: '1u' },
        { label: 'Drag', size: '2u' },
        { label: 'Space', size: '3u' },
        { label: 'Click', type: 'left-click' },
    ]} />);
    expect(caps(container)).toEqual([
        ['⇧', '1u', 'key'],
        ['Drag', '2u', 'key'],
        ['Space', '3u', 'key'],
        ['Click', '1u', 'left-click'],
    ]);
});

it('sizes the modifier chip for the platform label (⌘ on macOS, Ctrl elsewhere)', () => {
    const chip = { label: 'mod', variant: 'mod' as const, size: '3u' as const };
    const { container, rerender } = render(<KeyCap chip={chip} />);
    expect(caps(container)).toEqual([['mod', '2u', 'key']]);
    platform.mac = true;
    rerender(<KeyCap chip={{ ...chip }} />);
    expect(caps(container)).toEqual([['mod', '1u', 'key']]);
});

it('applies the key scale and an optional extra class', () => {
    const { container, rerender } = render(<Shortcut keys={[]} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe(styles.shortcut);
    expect(root.style.getPropertyValue('--key-scale')).toBe('1');
    rerender(<Shortcut keys={[]} scale={0.75} className="own" />);
    expect(root.className).toBe(`${styles.shortcut} own`);
    expect(root.style.getPropertyValue('--key-scale')).toBe('0.75');
});

it('keeps repeated labels as separate chips', () => {
    const { container } = render(<Shortcut keys={[{ label: 'Z' }, { label: 'Z' }]} />);
    expect(caps(container)).toEqual([['Z', '1u', 'key'], ['Z', '1u', 'key']]);
});

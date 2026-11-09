import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SearchInput from './SearchInput';
import styles from './SearchInput.module.scss';

const locale = vi.hoisted(() => ({ current: 'en-US' }));
vi.mock('@/assets/logos/search.svg?react', () => ({ default: () => <svg data-testid="search-icon" /> }));
vi.mock('@/locale', () => ({
    useLocale: () => locale.current,
    // The real catalog template, so the plural rule is part of the baseline.
    useTranslateUI: () => (key: string) => key === 'search.results' ? '{count, plural, one {# result} other {# results}}' : key,
}));
afterEach(() => { cleanup(); locale.current = 'en-US'; });

const renderInput = (value: string, resultCount = 0, onChange = vi.fn()) => {
    const view = render(<SearchInput value={value} resultCount={resultCount} placeholder="Search points" onChange={onChange} />);
    return { ...view, onChange, input: screen.getByPlaceholderText<HTMLInputElement>('Search points') };
};

it('is a controlled text field that reports each edit to the owner', () => {
    const { input, onChange } = renderInput('ore');
    expect(input.type).toBe('text');
    expect(input.value).toBe('ore');
    expect(input.dataset.searchInput).toBe('true');
    fireEvent.change(input, { target: { value: 'ore vein' } });
    expect(onChange).toHaveBeenCalledWith('ore vein');
    expect(screen.getByTestId('search-icon')).toBeTruthy();
});

it('shows a pluralized result count only for a non-blank query', () => {
    const { container, rerender } = renderInput('   ', 3);
    const row = container.querySelector('[data-has-count]')!;
    expect(row.getAttribute('data-has-count')).toBe('false');
    expect(screen.queryByText(/result/)).toBeNull();

    rerender(<SearchInput value="ore" resultCount={1} placeholder="Search points" onChange={vi.fn()} />);
    expect(row.getAttribute('data-has-count')).toBe('true');
    expect(screen.getByText('1 result')).toBeTruthy();
    rerender(<SearchInput value="ore" resultCount={0} placeholder="Search points" onChange={vi.fn()} />);
    expect(screen.getByText('0 results')).toBeTruthy();
    rerender(<SearchInput value="ore" resultCount={1200} placeholder="Search points" onChange={vi.fn()} />);
    expect(screen.getByText('1,200 results')).toBeTruthy();
});

it('formats the count for the active locale', () => {
    locale.current = 'de-DE';
    renderInput('erz', 1200);
    expect(screen.getByText('1.200 results')).toBeTruthy();
});

it('does not submit or navigate when Enter submits the form', () => {
    const { container } = renderInput('ore', 2);
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    container.querySelector('form')!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
});

it('applies the requested width and mobile layout', () => {
    const { container, rerender } = renderInput('');
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe('100%');
    expect(root.classList.contains(styles.mobile)).toBe(false);
    rerender(<SearchInput value="" resultCount={0} placeholder="Search points" onChange={vi.fn()} mobile width={240} />);
    expect(root.style.width).toBe('240px');
    expect(root.classList.contains(styles.mobile)).toBe(true);
});

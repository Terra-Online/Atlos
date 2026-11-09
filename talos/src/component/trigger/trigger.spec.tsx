import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Trigger, TriggerBar } from './trigger';
import styles from './trigger.module.scss';

vi.mock('../../assets/logos/on.svg?react', () => ({ default: () => <svg data-testid="on" /> }));
vi.mock('../../assets/logos/off.svg?react', () => ({ default: () => <svg data-testid="off" /> }));
afterEach(cleanup);

it('reports its state and requests the opposite state on click without leaking the event', () => {
    const onToggle = vi.fn();
    const parentClick = vi.fn();
    const { rerender } = render(<div onClick={parentClick}><Trigger label="Clusters" onToggle={onToggle} /></div>);
    const button = screen.getByRole('button', { name: 'Clusters', pressed: false });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.classList.contains(styles.active)).toBe(false);
    expect(screen.getByTestId('on')).toBeTruthy();
    expect(screen.getByTestId('off')).toBeTruthy();

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(click);
    expect(onToggle).toHaveBeenLastCalledWith(true);
    expect(click.defaultPrevented).toBe(true);
    expect(parentClick).not.toHaveBeenCalled();

    // The trigger is controlled: it only changes when the owner passes the new state.
    expect(button.getAttribute('aria-pressed')).toBe('false');
    rerender(<div onClick={parentClick}><Trigger label="Clusters" isActive onToggle={onToggle} /></div>);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.classList.contains(styles.active)).toBe(true);
    fireEvent.click(button);
    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(onToggle).toHaveBeenCalledTimes(2);
});

it('ignores clicks while disabled and marks the wrapper disabled', () => {
    const onToggle = vi.fn();
    const { container } = render(<Trigger label="Labels" disabled onToggle={onToggle} className="own" />);
    const button = screen.getByRole('button', { name: 'Labels' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
    const wrapper = container.firstElementChild!;
    expect(wrapper.classList.contains(styles.disabled)).toBe(true);
    expect(wrapper.classList.contains('own')).toBe(true);
});

it('shows a visible label only when one is given and tolerates a missing handler', () => {
    const { container, rerender } = render(<Trigger label="Boundary" />);
    expect(container.querySelector(`.${styles.triggerLabel}`)?.textContent).toBe('Boundary');
    fireEvent.click(screen.getByRole('button'));

    rerender(<Trigger />);
    expect(container.querySelector(`.${styles.triggerLabel}`)).toBeNull();
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('');
});

it('groups triggers in a container', () => {
    const { container } = render(<TriggerBar><Trigger label="A" /><Trigger label="B" /></TriggerBar>);
    const bar = container.firstElementChild!;
    expect(bar.classList.contains(styles.triggerContainer)).toBe(true);
    expect(bar.querySelectorAll('button')).toHaveLength(2);
});

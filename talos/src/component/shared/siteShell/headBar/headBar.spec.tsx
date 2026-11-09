import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HeadItem } from './headBar';

const device = vi.hoisted(() => ({ isMobile: false }));
vi.mock('@/platform/device', () => ({ useDevice: () => device }));
vi.mock('./headBar.mobile', () => ({ default: () => null }));
vi.mock('./headBar.desktop', () => ({ default: () => null }));
afterEach(cleanup);

it('removes tooltip anchors on mobile and when an action is hidden, while preserving activation', () => {
    const onClick = vi.fn();
    const icon = () => null;
    const view = render(<HeadItem icon={icon} tooltip="Language" onClick={onClick} />);
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBeTruthy();
    device.isMobile = true;
    view.rerender(<HeadItem icon={icon} tooltip="Language" onClick={onClick} />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
    device.isMobile = false;
    view.rerender(<HeadItem icon={icon} tooltip="Language" compactHidden />);
    expect(screen.queryByRole('tooltip')).toBeNull();
});

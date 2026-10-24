import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayerStore } from '@/store/layer';
import { LayerSwitch } from '@/pages/layerSwitch/layerSwitch';

vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: false }) }));
vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key }));
vi.mock('@/assets/images/UI/layer.svg?react', () => ({ default: () => null }));
afterEach(cleanup);

it('allows keyboard activation of the floor control and keeps floor choices outside the main button', () => {
    useLayerStore.setState({ currentLayer: 'B1' });
    render(<LayerSwitch isSidebarOpen={false} />);
    const main = screen.getByRole('button', { name: 'mapControls.layerSelect' });
    main.focus();
    userEvent.keyboard('{Enter}');
    expect(useLayerStore.getState().currentLayer).toBe('M');
    const basement = screen.getByRole('button', { name: 'Layer B1' });
    expect(main.contains(basement)).toBe(false);
    basement.focus();
    userEvent.keyboard(' ');
    expect(useLayerStore.getState().currentLayer).toBe('B1');
    expect(document.activeElement).toBe(basement);
});

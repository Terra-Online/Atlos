import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Carousel from '.';

afterEach(cleanup);

type Image = { id: string };
const images: Image[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const getKey = (image: Image) => image.id;

type State = Parameters<Parameters<typeof Carousel<Image>>[0]['children']>[0];
const capture = (items: Image[], selectedKey?: string | null, onSelectedKeyChange?: (key: string) => void) => {
    let state: State | undefined;
    const view = render(
        <Carousel items={items} selectedKey={selectedKey} getKey={getKey} onSelectedKeyChange={onSelectedKeyChange}>
            {(next) => { state = next; return <span>{next.item?.id ?? 'none'}</span>; }}
        </Carousel>,
    );
    return { view, state: () => state! };
};

it('exposes the selected item, its index and the item count', () => {
    const { state, view } = capture(images, 'b');
    expect(state()).toMatchObject({ item: images[1], index: 1, count: 3, hasMultiple: true });
    expect(view.container.textContent).toBe('b');
});

it('falls back to the first item when nothing or an unknown key is selected', () => {
    expect(capture(images).state()).toMatchObject({ item: images[0], index: 0 });
    cleanup();
    expect(capture(images, null).state().index).toBe(0);
    cleanup();
    expect(capture(images, 'gone').state()).toMatchObject({ item: images[0], index: 0 });
});

it('requests the neighbouring key and wraps at both ends without changing selection itself', () => {
    const change = vi.fn();
    const { state } = capture(images, 'a', change);
    state().previous();
    expect(change).toHaveBeenLastCalledWith('c');
    state().next();
    expect(change).toHaveBeenLastCalledWith('b');
    // Controlled: the index only moves when the owner passes a new key.
    expect(state().index).toBe(0);

    cleanup();
    const last = capture(images, 'c', change);
    last.state().next();
    expect(change).toHaveBeenLastCalledWith('a');
});

it('reports a single item as not navigable while still cycling to itself', () => {
    const change = vi.fn();
    const { state } = capture([{ id: 'only' }], 'only', change);
    expect(state()).toMatchObject({ index: 0, count: 1, hasMultiple: false });
    state().next();
    expect(change).toHaveBeenCalledWith('only');
});

it('renders an empty state and ignores navigation without items or a change handler', () => {
    const change = vi.fn();
    const { state, view } = capture([], 'a', change);
    expect(state()).toMatchObject({ item: null, index: -1, count: 0, hasMultiple: false });
    expect(view.container.textContent).toBe('none');
    state().next();
    state().previous();
    expect(change).not.toHaveBeenCalled();

    cleanup();
    const uncontrolled = capture(images, 'a');
    expect(() => uncontrolled.state().next()).not.toThrow();
});

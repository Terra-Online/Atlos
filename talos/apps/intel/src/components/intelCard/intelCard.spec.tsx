import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installResizeObserver, setRect } from '../../../../../test-support/browser';
import { archives, installIntersectionObserver } from '../../fixtures';
import IntelCard from './intelCard';
import VirtualIntelCard from './virtualIntelCard';
import styles from './intelCard.module.scss';

vi.mock('@intel/locale', async () => {
    const { translate } = await import('../../fixtures');
    return { useLocale: () => 'en-US', useTranslateUI: () => translate, useTranslateGame: () => translate };
});
vi.mock('@main/locale', () => ({ useTranslateGame: () => (key: string) => key }));

beforeEach(() => { vi.useFakeTimers(); installResizeObserver(); });
afterEach(async () => { cleanup(); await act(() => vi.runAllTimers()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const props = () => ({ archive: archives[0], collected: false, isTypeTarget: false, stackOrder: 7, onToggle: vi.fn(), onTypeTargetHover: vi.fn() });
const frames = async () => { await act(() => vi.advanceTimersToNextFrame()); await act(() => vi.advanceTimersToNextFrame()); };

it('keeps collection controlled and activates from the card, not from nested links', () => {
    const options = props();
    const view = render(<IntelCard {...options} isTypeTarget />);
    const card = screen.getByRole('button');
    expect(card.getAttribute('aria-pressed')).toBe('false');
    expect(within(card).getAllByText('Ore report')).toHaveLength(2);
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(options.onToggle).toHaveBeenCalledTimes(3);
    expect(options.onToggle).toHaveBeenLastCalledWith(archives[0]);
    expect(card.getAttribute('aria-pressed')).toBe('false');
    const link = screen.getByRole('link', { name: 'intel.mapSite' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('href')).toMatch(/https:\/\/oem\.re\/[a-zA-Z0-9]{7}$/);
    fireEvent.click(link);
    fireEvent.keyDown(link, { key: 'Enter' });
    expect(options.onToggle).toHaveBeenCalledTimes(3);
    fireEvent.mouseEnter(card);
    expect(options.onTypeTargetHover).toHaveBeenCalledWith(archives[0].id);
    view.rerender(<IntelCard {...options} collected />);
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(card.dataset.typeTarget).toBeUndefined();
    view.rerender(<IntelCard {...options} collected={false} />);
    expect(card.dataset.collectionTransition).toBe('uncollect');
});

it('keeps the reverse collection animation alive across unrelated renders until the progress bar finishes', () => {
    const animation = (target: Element, type: string, name: string) => {
        const event = new Event(type, { bubbles: true });
        Object.defineProperty(event, 'animationName', { value: name });
        fireEvent(target, event);
    };
    const options = props();
    const view = render(<IntelCard {...options} collected />);
    view.rerender(<IntelCard {...options} collected={false} />);
    const card = screen.getByRole('button');
    expect(card.dataset.collectionTransition).toBe('uncollect');
    view.rerender(<IntelCard {...options} collected={false} stackOrder={8} />);
    expect(card.dataset.collectionTransition).toBe('uncollect');
    fireEvent.animationEnd(card);
    expect(card.dataset.collectionTransition).toBe('uncollect');
    const horizontal = card.querySelector(`.${styles.progressHorizontal}`)!;
    // A quick reversal cancels the old forward animation on the same element.
    animation(horizontal, 'animationcancel', styles.intelProgressHorizontal);
    expect(card.dataset.collectionTransition).toBe('uncollect');
    animation(horizontal, 'animationend', styles.intelProgressHorizontalReverse);
    expect(card.dataset.collectionTransition).toBeUndefined();
    view.rerender(<IntelCard {...options} collected />);
    expect(card.dataset.collectionTransition).toBeUndefined();
    view.rerender(<IntelCard {...options} collected={false} />);
    animation(card.querySelector(`.${styles.progressVertical}`)!, 'animationcancel', styles.intelProgressVerticalReverse);
    expect(card.dataset.collectionTransition).toBeUndefined();
});

it('defers map previews until near the viewport and cleans up visibility ownership', () => {
    const observers = installIntersectionObserver();
    const view = render(<IntelCard {...props()} />);
    const preview = screen.getByRole('link').querySelector('img')!;
    expect(preview.hasAttribute('src')).toBe(false);
    const observer = observers.find((item) => item.targets.has(preview))!;
    act(() => observer.notify(preview, false));
    expect(preview.hasAttribute('src')).toBe(false);
    act(() => observer.notify(preview, true));
    expect(preview.getAttribute('src')).toMatch(/^https:\/\/cdn\.opendfieldmap\.org\/_beta\/endfield\/atlos\/seo\/og\/r2\//);
    expect(observer.targets.size).toBe(0);
    view.unmount();
    expect(observers.every((item) => item.targets.size === 0)).toBe(true);
});

it.each([
    { archive: archives[1], text: ['First mission', 'Final stage'] },
    { archive: archives[2], text: ['Automatically unlocked', 'Unlocks through the main story'] },
    { archive: archives[5], text: ['Unlock condition unconfirmed'] },
    { archive: archives[3], text: ['Valley - Hub', 'Trader', 'Trading post'] },
    { archive: archives[4], text: ['Investigate ore'] },
])('renders acquisition instructions for $archive.id', ({ archive, text }) => {
    render(<IntelCard {...props()} archive={archive} />);
    text.forEach((value) => expect(screen.getByRole('button').textContent).toContain(value));
    expect(screen.getByRole('button').textContent).not.toMatch(/<\/?(?:b|em)>/);
    expect(screen.getByRole('button').textContent).not.toContain('intel.centralUnlock');
    if (archive.acquisition.method === 'shop') expect(screen.getAllByRole('link')).toHaveLength(2);
});

it('keeps main-story guidance for an unresolved central archive and preserves known mission routes', () => {
    const archive = { ...archives[2], acquisition: { method: 'unknown' as const } };
    const view = render(<IntelCard {...props()} archive={archive} />);
    expect(screen.getByRole('button').textContent).toContain('Automatically unlocked');
    expect(screen.getByRole('button').textContent).toContain('Unlocks through the main story');
    expect(screen.getByRole('button').textContent).not.toContain('Unlock condition unconfirmed');
    view.rerender(<IntelCard {...props()} archive={{ ...archive, acquisition: archives[1].acquisition }} />);
    expect(screen.getByRole('button').textContent).toContain('First mission');
    expect(screen.getByRole('button').textContent).not.toContain('Unlocks through the main story');
});

it('renders optional map interactions and special NPC instructions without discarding the mission sequence', () => {
    const archive = { ...archives[1], acquisition: { method: 'mission' as const, missionId: 'mission:1', interaction: { pointId: 42, stageId: 'quest:1' } } };
    const view = render(<IntelCard {...props()} archive={archive} />);
    expect(screen.getByRole('link').textContent).toContain('puzzle');
    expect(screen.getByRole('button').textContent).toContain('intel.optionalCondition');
    view.rerender(<IntelCard {...props()} archive={{ ...archive, acquisition: { ...archive.acquisition, special: { npcId: 'npc:1', dialogOptionId: 'dialog:1', bakerChatId: 'chat', bakerDialogId: 'dialog' } } }} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button').textContent).toContain('Ask Trader about dialog:1');
    expect(screen.getByRole('button').textContent).toContain('First mission');
});

describe('virtualized cards', () => {
    it('retains measured geometry offscreen, restores content on return, and disables virtualization during expansion', async () => {
        const observers = installIntersectionObserver();
        const rootRef = createRef<HTMLDivElement>();
        const options = { ...props(), rootRef };
        const view = render(<div ref={rootRef}><VirtualIntelCard {...options} virtualize /></div>);
        const article = screen.getByRole('button');
        setRect(article, 0, 0, 300, 178.2);
        await frames();
        const shell = article.parentElement!;
        const observer = observers.find((item) => item.root === rootRef.current && item.targets.has(shell))!;
        expect(shell.style.getPropertyValue('--intel-card-expanded-height')).toBe('180px');
        act(() => observer.notify(shell, false));
        expect(screen.queryByRole('button')).toBeNull();
        const placeholder = rootRef.current!.firstElementChild as HTMLElement;
        expect(placeholder.dataset.intelArchive).toBe(archives[0].id);
        expect(placeholder.getAttribute('aria-hidden')).toBe('true');
        expect(placeholder.style.getPropertyValue('--intel-card-expanded-height')).toBe('180px');
        const rebound = [...observers].reverse().find((item) => item.root === rootRef.current && item.targets.has(placeholder))!;
        expect(observer.targets.size).toBe(0);
        act(() => rebound.notify(placeholder, true));
        expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
        const nextShell = screen.getByRole('button').parentElement!;
        act(() => [...observers].reverse().find((item) => item.root === rootRef.current && item.targets.has(nextShell))!.notify(nextShell, false));
        view.rerender(<div ref={rootRef}><VirtualIntelCard {...options} virtualize={false} /></div>);
        expect(screen.getByRole('button')).toBeTruthy();
        view.unmount();
        expect(observers.every((item) => item.targets.size === 0)).toBe(true);
    });

    it('keeps full cards available when IntersectionObserver is unavailable', () => {
        vi.stubGlobal('IntersectionObserver', undefined);
        Reflect.deleteProperty(window, 'IntersectionObserver');
        render(<VirtualIntelCard {...props()} virtualize rootRef={{ current: null }} />);
        expect(screen.getByRole('button').textContent).toContain('Ore report');
    });
});

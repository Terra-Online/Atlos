import { afterEach, expect, it, vi } from 'vitest';
import { registerOverlay } from './overlay';

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.reverse().forEach((fn) => fn()); cleanups.length = 0; document.body.replaceChildren(); document.body.style.overflow = ''; });
function open(doc: Document, modal = false, trigger?: HTMLElement) {
    const element = doc.createElement('div');
    element.tabIndex = -1;
    doc.body.appendChild(element);
    const onDismiss = vi.fn();
    const layer = registerOverlay({ element, modal, trigger, onDismiss });
    cleanups.push(() => layer.dispose());
    return { element, onDismiss, ...layer };
}

it('dismisses only the top layer and restores focus to the parent modal', () => {
    const parent = open(document, true);
    const trigger = document.createElement('button');
    parent.element.appendChild(trigger);
    trigger.focus();
    const child = open(document, true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(child.onDismiss).toHaveBeenCalledOnce();
    expect(parent.onDismiss).not.toHaveBeenCalled();
    child.dispose();
    expect(document.activeElement).toBe(trigger);
    expect(parent.element.inert).toBe(false);
});

it('keeps scroll locked when modals are removed out of order', () => {
    document.body.style.overflow = 'auto';
    const first = open(document, true);
    const second = open(document, true);
    first.dispose();
    expect(document.body.style.overflow).toBe('hidden');
    second.dispose();
    expect(document.body.style.overflow).toBe('auto');
});

it('keeps documents independent and leaves composing Escape untouched', () => {
    const other = document.implementation.createHTMLDocument();
    const main = open(document, true);
    const pip = open(other, true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }));
    expect(main.onDismiss).not.toHaveBeenCalled();
    other.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(pip.onDismiss).toHaveBeenCalledOnce();
    expect(main.onDismiss).not.toHaveBeenCalled();
});

it('closes unrelated transient overlays when opening a modal', () => {
    const hint = open(document);
    open(document, true);
    expect(hint.onDismiss).toHaveBeenCalledOnce();
});

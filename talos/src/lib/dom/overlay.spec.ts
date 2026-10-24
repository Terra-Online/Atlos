import { afterEach, expect, it, vi } from 'vitest';
import { dismissTransientOverlays, registerOverlay } from './overlay';

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
    expect(parent.element.hasAttribute('inert')).toBe(false);
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

it('keeps modal Tab trapping while a focus tooltip is above it', () => {
    const modal = open(document, true);
    const first = document.createElement('button');
    const last = document.createElement('button');
    for (const button of [first, last]) {
        Object.defineProperty(button, 'getClientRects', { value: () => [new DOMRect(0, 0, 20, 20)] });
        modal.element.append(button);
    }
    last.focus();
    open(document, false, last);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
});

it('keeps exiting layers inert through stack changes, permits reentry, and restores menu focus', () => {
    const parent = open(document, true);
    const trigger = document.createElement('button');
    parent.element.append(trigger);
    trigger.focus();
    const element = document.createElement('div');
    element.tabIndex = -1;
    document.body.append(element);
    const menu = registerOverlay({ element, restoreFocus: true, onDismiss: vi.fn() });
    cleanups.push(() => menu.dispose());
    element.focus();
    menu.setActive(false);
    const child = open(document, true);
    child.dispose();
    expect(element.hasAttribute('inert')).toBe(true);
    menu.setActive(true);
    expect(element.hasAttribute('inert')).toBe(false);
    element.focus();
    menu.dispose();
    expect(document.activeElement).toBe(trigger);
});

it('retains document listeners when opening a modal immediately disposes its tooltip', () => {
    const element = document.createElement('div');
    document.body.append(element);
    const tooltip = registerOverlay({ element, onDismiss: () => tooltip.dispose() });
    const modal = open(document, true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(modal.onDismiss).toHaveBeenCalledOnce();
});

it('closes transient UI before document migration without dismissing modals or other documents', () => {
    const modal = open(document, true);
    const tooltip = open(document);
    const other = document.implementation.createHTMLDocument();
    const separate = open(other);
    dismissTransientOverlays(document);
    expect(tooltip.onDismiss).toHaveBeenCalledOnce();
    expect(tooltip.element.hasAttribute('inert')).toBe(true);
    expect(modal.onDismiss).not.toHaveBeenCalled();
    expect(separate.onDismiss).not.toHaveBeenCalled();
});

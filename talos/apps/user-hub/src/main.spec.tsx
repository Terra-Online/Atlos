import { afterEach, expect, it, vi } from 'vitest';

const boot = vi.hoisted(() => ({ render: vi.fn(), create: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: boot.create }));
vi.mock('./App', () => ({ default: () => null }));
vi.mock('@hub/locale', () => ({ i18nInitPromise: Promise.resolve() }));
vi.mock('@main/locale', () => ({ i18nInitPromise: Promise.resolve() }));
vi.mock('@hub/styles/global.scss', () => ({}));

const fontDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => {
    document.body.replaceChildren();
    if (fontDescriptor) Object.defineProperty(document, 'fonts', fontDescriptor);
    else Reflect.deleteProperty(document, 'fonts');
    vi.resetModules(); vi.restoreAllMocks(); vi.clearAllMocks();
});
it('requires its root and still renders after optional layout fonts reject', async () => {
    await expect(import('./main')).rejects.toThrow('User hub root is missing');
    vi.resetModules();
    const root = document.createElement('div'); root.id = 'root'; document.body.append(root);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: vi.fn().mockRejectedValue(new Error('font offline')) } });
    boot.create.mockReturnValue({ render: boot.render });
    await import('./main');
    await vi.waitFor(() => expect(boot.render).toHaveBeenCalledOnce());
    expect(boot.create).toHaveBeenCalledWith(root);
});

import { afterEach, expect, it, vi } from 'vitest';

const boot = vi.hoisted(() => ({ catalog: Promise.resolve(), mainCatalog: Promise.resolve(), render: vi.fn(), create: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: boot.create }));
vi.mock('./App', () => ({ default: () => null }));
vi.mock('@intel/locale', () => ({ get i18nInitPromise() { return boot.catalog; } }));
vi.mock('@main/locale', () => ({ get i18nInitPromise() { return boot.mainCatalog; } }));
vi.mock('./styles/global.scss', () => ({}));
vi.mock('./styles/overrides.scss', () => ({}));

const fontDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => {
    document.body.replaceChildren();
    if (fontDescriptor) Object.defineProperty(document, 'fonts', fontDescriptor);
    else Reflect.deleteProperty(document, 'fonts');
    vi.resetModules(); vi.restoreAllMocks(); vi.clearAllMocks();
});
it('requires its root and waits for both catalogs and layout fonts before rendering', async () => {
    await expect(import('./main')).rejects.toThrow('Intel root element is missing');
    vi.resetModules();
    const root = document.createElement('div'); root.id = 'root'; document.body.append(root);
    let resolveFonts!: () => void;
    let resolveCatalog!: () => void;
    let resolveMainCatalog!: () => void;
    boot.catalog = new Promise<void>((resolve) => { resolveCatalog = resolve; });
    boot.mainCatalog = new Promise<void>((resolve) => { resolveMainCatalog = resolve; });
    const pending = new Promise<void>((resolve) => { resolveFonts = resolve; });
    const load = vi.fn<(font: string) => Promise<void>>().mockReturnValue(pending);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    boot.create.mockReturnValue({ render: boot.render });
    await import('./main');
    expect(load.mock.calls.map(([font]) => font)).toEqual(["500 1rem 'HMSans_EN'", "700 1rem 'HMSans_EN'", "500 1rem 'Novecento Medium'", "700 1rem 'Novecento DemiBold'"]);
    expect(boot.render).not.toHaveBeenCalled();
    resolveFonts();
    resolveCatalog();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(boot.render).not.toHaveBeenCalled();
    resolveMainCatalog();
    await vi.waitFor(() => expect(boot.render).toHaveBeenCalledOnce());
    expect(boot.create).toHaveBeenCalledWith(root);
});

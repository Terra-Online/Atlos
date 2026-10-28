/** Separate diagnostic builds only. Default production builds emit no probe. */
export function startupProbe() {
    if (process.env.BENCH_STARTUP_PROBE !== '1') return null;
    const replace = (source, before, after) => {
        if (source.split(before).length !== 2) throw new Error(`Startup probe anchor is missing or ambiguous: ${before}`);
        return source.replace(before, after);
    };
    const mark = (name) => `performance.mark('atlos:${name}');`;
    return {
        name: 'atlos-startup-diagnostic-probe', enforce: 'pre',
        transform(code, id) {
            const file = id.replaceAll('\\', '/').split('?')[0];
            if (file.endsWith('/src/locale/index.ts') && !file.includes('/apps/')) return replace(code, 'export const i18nInitPromise = init();',
                `${mark('i18n:start')}\nexport const i18nInitPromise = init();\nvoid i18nInitPromise.then(() => { ${mark('i18n:end')} });`);
            if (!file.endsWith('/src/main.tsx') || file.includes('/apps/')) return null;
            let source = replace(code, 'async function bootstrap(){', `async function bootstrap(){\n    ${mark('bootstrap:start')}`);
            source = replace(source, 'const region = resolveInitialRegion(window.location);', `${mark('region:start')}\n    const region = resolveInitialRegion(window.location);`);
            source = replace(source, 'const resources = region.then((regionId) => {', `const resources = region.then((regionId) => {\n        ${mark('region:end')}`);
            for (const [anchor, stage] of [
                ['await i18nInitPromise;', 'i18n-wait'],
                ['await applyUrlParams();', 'url-state'],
                ["await prepareInitialNavigation().catch((error: unknown) => console.warn('Initial navigation preparation unavailable:', error));", 'navigation'],
                ['await fontLoader();', 'font-registration'],
            ]) source = replace(source, anchor, `${mark(stage + ':start')}\n    ${anchor}\n    ${mark(stage + ':end')}`);
            source = replace(source, "await preloadMapFonts(await resources).catch((error: unknown) => console.warn('Initial map fonts unavailable:', error));",
                `${mark('region-wait:start')}\n    const probeRegion = await resources;\n    ${mark('region-wait:end')}\n    ${mark('map-fonts:start')}\n    await preloadMapFonts(probeRegion).catch((error: unknown) => console.warn('Initial map fonts unavailable:', error));\n    ${mark('map-fonts:end')}`);
            source = replace(source, 'createRoot(rootElement).render(<MapPage />);', `createRoot(rootElement).render(<MapPage />);\n    ${mark('render-request')}`);
            return source;
        },
    };
}

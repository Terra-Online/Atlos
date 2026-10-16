// Global type declarations
declare global {
    const __ASSETS_HOST: string;
    const __APP_VERSION__: string;
    const __SEARCH_DOC_VERSIONS__: Readonly<Record<string, string>>;

    interface Window {
        __OEM_ACCEPT_LANGUAGE__?: string;
    }

    namespace NodeJS {
        interface ProcessEnv {
            ASSET_HOST?: string;
            NODE_ENV: 'development' | 'production' | 'test';
        }
    }
}

// Module declarations
declare module '*.json' {
    const value: unknown;
    export default value;
}

declare module '*.svg' {
    import type React from 'react';
    export const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
    const src: string;
    export default src;
}

declare module '*.png' {
    const content: string;
    export default content;
}

declare module '*.jpg' {
    const content: string;
    export default content;
}

declare module '*.jpeg' {
    const content: string;
    export default content;
}

declare module '*.gif' {
    const content: string;
    export default content;
}

declare module '*.webp' {
    const content: string;
    export default content;
}

declare module '*.scss' {
    const content: { [className: string]: string };
    export default content;
}

declare module '*.css' {
    const content: { [className: string]: string };
    export default content;
}

export { };

/** Immutable region manifests emitted by the shared font asset plugin. */
declare global {
    const __FONT_SHARD_MANIFESTS__: Partial<Record<'CN' | 'HK' | 'JP', string>>;
}

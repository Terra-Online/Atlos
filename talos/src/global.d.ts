// Global type declarations
declare global {
    const __ASSETS_HOST: string;
    const __APP_VERSION__: string;

    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Window {

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
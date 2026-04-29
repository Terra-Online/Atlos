/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_ENDFIELD_LOCATOR_TRANSFORMS?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

interface Window {
    __ENDFIELD_LOCATOR_TRANSFORMS__?: string | Record<string, unknown>;
}

declare module '*.svg?react' {
    import { FC, SVGProps } from 'react';
    const ReactComponent: FC<SVGProps<SVGSVGElement>>;
    export default ReactComponent;
}

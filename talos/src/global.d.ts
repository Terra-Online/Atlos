// 全局类型定义
declare global {
    declare const __ASSETS_HOST: string;

    interface Window {

    }

    namespace NodeJS {
        interface ProcessEnv {
            ASSET_HOST?: string;
            NODE_ENV: 'development' | 'production' | 'test';
        }
    }
}

// 模块声明
declare module '*.json' {
    const value: any;
    export default value;
}

declare module '*.svg' {
    import React = require('react');
    export const ReactComponent: React.SFC<React.SVGProps<SVGSVGElement>>;
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

import L from 'leaflet';
import { createRoot, Root } from 'react-dom/client';
import { LinkToolUI } from './LinkToolUI';

let toolRoot: Root | null = null;

export const bootstrapLinkTool = (map: L.Map): void => {
    // Create container for React UI
    const container = document.createElement('div');
    container.id = 'link-tool-container';
    container.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        z-index: 10000;
        pointer-events: auto;
    `;
    document.body.appendChild(container);

    toolRoot = createRoot(container);
    toolRoot.render(<LinkToolUI map={map} />);

    // Notify map that link tool is mounted
    map.fire('talos:linkToolMounted');

    console.log('[LinkTool] Mounted');
};

export const unmountLinkTool = (): void => {
    if (toolRoot) {
        toolRoot.unmount();
        toolRoot = null;
    }
    const container = document.getElementById('link-tool-container');
    if (container) {
        container.remove();
    }
};

import { transport } from './transport';
import { openTraversalPicks } from '@endfield-noclip/package-format/story';
import { httpSource, type Viewer } from '@endfield-noclip/viewer/host';

export const scenes = {
    async json(url: string | URL, signal?: AbortSignal): Promise<unknown> {
        const response = await transport.fetch('scene', url, { signal });
        if (!response.ok)
            throw new Error(`Scene data: HTTP ${response.status}`);
        return response.json();
    },
    package(url: string) {
        return httpSource(url, (input, init, range) => {
            return transport.fetch('scene', input, init, range?.content);
        });
    },
};

export function sceneReference(viewer: Viewer): {
    generation: string;
    state: 'fully-enabled';
} {
    const manifest = viewer.scene?.pkg.manifest;
    if (!manifest) throw new Error('Scene is not ready');
    const expected = openTraversalPicks(manifest.states.controls);
    const actual = viewer.scenePicks;
    if (
        Object.keys(expected).length !== Object.keys(actual).length ||
        Object.entries(expected).some(([key, value]) => actual[key] !== value)
    )
        throw new Error('Routing supports the fully enabled scene state');
    return { generation: manifest.generation, state: 'fully-enabled' };
}

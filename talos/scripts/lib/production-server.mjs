import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
const within = (root, file) => file === root || file.startsWith(root + path.sep);

/** Serve the frozen full-site layout. Missing assets never receive SPA HTML. */
export async function readProductionArtifact(dist) {
    const root = await realpath(path.resolve(dist));
    const info = JSON.parse(await readFile(path.join(root, '.atlos-build.json'), 'utf8'));
    if (info.sourceOnly || !['main', 'intel', 'user-hub'].every((app) => info.apps.includes(app)))
        throw new Error('A complete local-asset production artifact is required.');
    for (const entry of ['index.html', 'intel/index.html', 'me/index.html']) await stat(path.join(root, entry));
    const assets = new URL(info.resources.assetsHost.replace(/\/$/, '') + '/');
    return { root, info, assets, resourceUrl(url, origin) {
        if (url.origin !== assets.origin || !url.pathname.startsWith(assets.pathname)) return null;
        return new URL('/' + url.pathname.slice(assets.pathname.length) + url.search, origin).href;
    } };
}

export async function createProductionServer({ dist, port = 0 }) {
    const artifact = await readProductionArtifact(dist);
    const { root } = artifact;
    const missing = [];
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        try {
            if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
            let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            if (!path.posix.extname(relative)) relative = relative.startsWith('me/') || relative === 'me' ? 'me/index.html'
                : relative === 'intel' || relative.startsWith('intel/') ? 'intel/index.html' : relative === '' ? 'index.html' : relative;
            const candidate = path.resolve(root, relative);
            if (!within(root, candidate)) throw new Error('Invalid path');
            const file = await realpath(candidate);
            if (!within(root, file)) throw new Error('Invalid symlink');
            const body = await readFile(file);
            response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream',
                'content-length': body.length, 'access-control-allow-origin': '*', 'timing-allow-origin': '*',
                'cache-control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' });
            response.end(request.method === 'HEAD' ? undefined : body);
        } catch {
            missing.push(url.pathname); response.writeHead(404, { 'content-type': 'text/plain' }); response.end('Missing frozen resource');
        }
    });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, 'localhost', done); });
    const origin = `http://localhost:${server.address().port}`;
    return { ...artifact, missing, origin,
        close: () => new Promise((done, reject) => server.close((error) => error ? reject(error) : done())),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const { values } = parseArgs({ options: { dist: { type: 'string', default: process.env.BEHAVIOR_DIST }, port: { type: 'string', default: '4173' } } });
    if (!values.dist) throw new Error('Provide --dist pointing at a frozen full-site artifact.');
    const server = await createProductionServer({ dist: values.dist, port: Number(values.port) });
    console.log(`Frozen production preview: ${server.origin}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveDeployPrefix } from './release-channel.js';

export const createReleaseStore = async (runner, options, target) => {
    const storage = target === 'org' ? 'r2' : 'oss';
    const config = JSON.parse(
        await fs.readFile(
            path.join(
                runner.root,
                'config',
                storage === 'r2' ? 'config.r2.json' : 'config.json',
            ),
            'utf8',
        ),
    );
    const build = config.web.build;
    const settings = build[storage];
    const { prefix } = resolveDeployPrefix({
        basePrefix: settings.prefix,
        channel: options.channel,
        target: storage,
        deployChannels: build.deployChannels,
        env: runner.env,
    });
    const key =
        `${prefix.replace(/^\/+|\/+$/g, '')}/_release/${target}-${options.channel}`.replace(
            /^\//,
            '',
        );
    let get, put;
    if (storage === 'r2') {
        const { S3Client, GetObjectCommand, PutObjectCommand } = await import(
            '@aws-sdk/client-s3'
        );
        const client = new S3Client({
            endpoint: settings.endpoint,
            region: settings.region || 'auto',
            forcePathStyle: true,
            maxAttempts: 1,
            credentials: {
                accessKeyId: settings.accessKeyId,
                secretAccessKey: settings.accessKeySecret,
            },
        });
        get = async (name) => {
            const result = await client.send(
                new GetObjectCommand({ Bucket: settings.bucket, Key: name }),
                { abortSignal: runner.signal },
            );
            return result.Body.transformToString();
        };
        put = (name, body) =>
            client.send(
                new PutObjectCommand({
                    Bucket: settings.bucket,
                    Key: name,
                    Body: body,
                    ContentType: 'application/json',
                    CacheControl: 'no-store',
                }),
                { abortSignal: runner.signal },
            );
    } else {
        const { default: OSS } = await import('ali-oss');
        const client = new OSS({
            ...settings,
            authorizationV4: true,
            timeout: 120000,
        });
        get = async (name) => (await client.get(name)).content.toString();
        put = (name, body) =>
            client.put(name, Buffer.from(body), {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store',
                },
            });
    }
    return {
        async read() {
            try {
                return JSON.parse(await get(`${key}/state.json`));
            } catch (error) {
                if (
                    error.status === 404 ||
                    error.$metadata?.httpStatusCode === 404
                )
                    return null;
                throw error;
            }
        },
        write: (state) => put(`${key}/state.json`, JSON.stringify(state)),
    };
};

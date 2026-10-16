import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolveDeployPrefix } from './release-channel.js';

// Do not expire locks automatically: an upload may still be running on another host.
export const withLocalLock = async (root, action) => {
    const directory = path.join(root, '.cache');
    const file = path.join(directory, 'release.lock');
    await fs.mkdir(directory, { recursive: true });
    let handle;
    try {
        handle = await fs.open(file, 'wx');
    } catch (error) {
        if (error.code === 'EEXIST')
            throw new Error(
                `Another release/build holds ${file}. Inspect its owner before removing a stale lock.`,
            );
        throw error;
    }
    try {
        await handle.writeFile(
            JSON.stringify({ pid: process.pid, host: os.hostname() }),
        );
        return await action();
    } finally {
        await handle.close();
        await fs.unlink(file);
    }
};

// Object APIs are needed here for conditional creation; rclone remains suitable
// for transfers and explicit recovery, but cannot implement this lock's contract.
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
    let get, put, remove;
    if (storage === 'r2') {
        const {
            S3Client,
            GetObjectCommand,
            PutObjectCommand,
            DeleteObjectCommand,
        } = await import('@aws-sdk/client-s3');
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
            );
            return result.Body.transformToString();
        };
        put = (name, body, exclusive) =>
            client.send(
                new PutObjectCommand({
                    Bucket: settings.bucket,
                    Key: name,
                    Body: body,
                    ContentType: 'application/json',
                    CacheControl: 'no-store',
                    ...(exclusive ? { IfNoneMatch: '*' } : {}),
                }),
            );
        remove = (name) =>
            client.send(
                new DeleteObjectCommand({ Bucket: settings.bucket, Key: name }),
            );
    } else {
        const { default: OSS } = await import('ali-oss');
        const client = new OSS({
            ...settings,
            authorizationV4: true,
            timeout: 120000,
        });
        // OSS ignores forbid-overwrite on versioned (including suspended) buckets.
        const versioning = await client.getBucketVersioning(settings.bucket);
        if (versioning.versionStatus)
            throw new Error(
                'Safe releases require an unversioned OSS bucket for exclusive release locks.',
            );
        get = async (name) => (await client.get(name)).content.toString();
        put = (name, body, exclusive) =>
            client.put(name, Buffer.from(body), {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store',
                    ...(exclusive ? { 'x-oss-forbid-overwrite': 'true' } : {}),
                },
            });
        remove = (name) => client.delete(name);
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
        write: (state) =>
            put(`${key}/state.json`, JSON.stringify(state), false),
        async acquire() {
            const owner = randomUUID();
            // An uncertain network failure may have created the object. Leave it
            // in place until an operator verifies that no publisher is running.
            try {
                await put(
                    `${key}/lock.json`,
                    JSON.stringify({
                        owner,
                        host: os.hostname(),
                        pid: process.pid,
                        startedAt: new Date().toISOString(),
                    }),
                    true,
                );
            } catch (error) {
                throw new Error(
                    `Cannot acquire release lock in ${settings.bucket}/${key}/lock.json; inspect the lock before retrying.`,
                    { cause: error },
                );
            }
            return async () => {
                const current = JSON.parse(await get(`${key}/lock.json`));
                if (current.owner !== owner)
                    throw new Error(
                        'Release lock ownership changed; refusing to remove it.',
                    );
                await remove(`${key}/lock.json`);
            };
        },
    };
};

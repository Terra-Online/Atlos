import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createRunner } from './task-runner.mjs';
import { check, dataTask, lint, test, typeCheck } from './checks.mjs';
import { pagesConfig } from './pages-config.mjs';
import {
    targets,
    apps,
    receipt,
    verifyArtifact,
    resourceConfig,
    verifyOutput,
} from './release-artifact.mjs';
const help = `Usage: pnpm <command> [options]
  build       --target cn|org|all [--app main|intel|user-hub]
  deploy:all  [--skip-og] [--skip-subset]
  deploy:cn / deploy:org [--channel prod|beta]
  run publish --target cn|org [--only oss|r2|server|pages|resources]
  package     --target cn|org [--format archive|pages] [--skip-build]
  og          [--target cn|org|all] [--action build|publish|refresh]
  worker      search|relink check|deploy
  check [--build] / lint / lint:fix / type-check / test
  type-check [--app main|intel|user-hub|relink|search]
  run test    [--app main|intel|user-hub|relink|scripts]
  data        prepare|check|overrides|intel|locale|tile-coverage|marker-stats|marker-diff|search-index|relink-preview|sync-intel|seo
  data fonts  [--app main|intel|user-hub|all]
Common: --channel prod|beta, --dry-run, --help
CI source checks/builds: --source-only (omits private Intel icons; artifact cannot be published)
Build/deploy: --skip-subset (alias --skip-subset-fonts), --skip-intel
Publish/deploy: --skip-og (alias --skip-seo-og)
Build/publish/package: --dist-dir PATH (single target only)
Package: --output-dir PATH
Defaults: build=org/prod; deploy=all/prod; og=all/build; package=cn/prod/archive.
Build and check never deploy. Dry-run only prints commands; it does not validate existing files.`;

const schemas = {
    build: [
        'target',
        'channel',
        'app',
        'dist-dir',
        'skip-subset',
        'skip-subset-fonts',
        'skip-intel',
        'source-only',
    ],
    deploy: [
        'target',
        'channel',
        'skip-subset',
        'skip-subset-fonts',
        'skip-og',
        'skip-seo-og',
        'skip-intel',
    ],
    publish: [
        'target',
        'channel',
        'only',
        'dist-dir',
        'skip-og',
        'skip-seo-og',
        'skip-intel',
    ],
    package: [
        'target',
        'channel',
        'format',
        'skip-build',
        'dist-dir',
        'output-dir',
        'skip-subset',
        'skip-subset-fonts',
        'skip-intel',
    ],
    og: ['target', 'channel', 'action'],
    worker: [],
    check: ['source-only', 'build', 'skip-subset', 'skip-subset-fonts'],
    lint: [],
    'lint:fix': [],
    'type-check': ['app'],
    test: ['app'],
    data: ['app', 'source-only'],
};
const flags = new Set([
    'skip-subset',
    'skip-subset-fonts',
    'skip-og',
    'skip-seo-og',
    'skip-intel',
    'skip-build',
    'dry-run',
    'help',
    'source-only',
    'build',
]);

export const parseTask = (argv, env = process.env) => {
    const [command = 'help', ...args] = argv.filter((arg) => arg !== '--');
    if (command === 'help' || command === '--help') return { command: 'help' };
    if (!schemas[command]) throw new Error(`Unknown command: ${command}`);
    const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: Object.fromEntries(
            [...schemas[command], 'dry-run', 'help'].map((name) => [
                name,
                { type: flags.has(name) ? 'boolean' : 'string' },
            ]),
        ),
    });
    if (values.help) return { command: 'help' };
    if (positionals.length && !['worker', 'data'].includes(command))
        throw new Error(`Unexpected arguments: ${positionals.join(' ')}`);
    const target =
        values.target || (['deploy', 'og'].includes(command) ? 'all' : 'org');
    const channel = values.channel || env.DEPLOY_CHANNEL || 'prod';
    if (!['prod', 'beta'].includes(channel))
        throw new Error(`Unknown channel: ${channel}`);
    if (!['cn', 'org', 'all'].includes(target))
        throw new Error(`Unknown target: ${target}`);
    if (['publish', 'package'].includes(command) && target === 'all')
        throw new Error(`${command} requires a single target.`);
    if (command === 'publish' && !values.target)
        throw new Error('publish requires --target cn or org.');
    if (values['dist-dir'] && target === 'all')
        throw new Error('--dist-dir requires a single target.');
    const allowedApps =
        command === 'type-check'
            ? ['all', ...Object.keys(apps), 'search', 'relink']
            : command === 'test'
              ? ['all', ...Object.keys(apps), 'relink', 'scripts']
              : ['all', ...Object.keys(apps)];
    if (values.app && !allowedApps.includes(values.app)) {
        throw new Error(`Unknown app: ${values.app}`);
    }
    if (command === 'build' && values.app === 'all') delete values.app;
    if (values.app && values['skip-intel'])
        throw new Error('--app and --skip-intel cannot be combined.');
    const only = values.only || 'all';
    if (command === 'publish') {
        const allowed =
            target === 'cn'
                ? ['all', 'oss', 'server']
                : ['all', 'r2', 'resources', 'pages'];
        if (!allowed.includes(only))
            throw new Error(`Unsupported ${target} publish channel: ${only}`);
    }
    if (
        ((command === 'deploy' && target !== 'org') ||
            (command === 'publish' &&
                target === 'cn' &&
                ['all', 'server'].includes(only))) &&
        channel === 'beta'
    ) {
        throw new Error(
            'The CN server serves prod only. Use --target org for beta, or publish --target cn --only oss for beta resources.',
        );
    }
    const format = values.format || 'archive';
    if (command === 'package' && !['archive', 'pages'].includes(format))
        throw new Error(`Unknown package format: ${format}`);
    if (command === 'package' && format === 'pages' && target !== 'org')
        throw new Error('Pages packaging requires --target org.');
    const action = values.action || 'build';
    if (command === 'og' && !['build', 'publish', 'refresh'].includes(action))
        throw new Error(`Unknown OG action: ${action}`);
    if (
        command === 'worker' &&
        (positionals.length !== 2 ||
            !['search', 'relink'].includes(positionals[0]) ||
            !['check', 'deploy'].includes(positionals[1]))
    ) {
        throw new Error('Use worker search|relink check|deploy.');
    }
    if (
        command === 'data' &&
        (positionals.length > 1 || (values.app && positionals[0] !== 'fonts'))
    )
        throw new Error('Only data fonts accepts --app.');
    return {
        command,
        target,
        channel,
        only,
        format,
        action,
        positionals,
        app: values.app,
        distDir: values['dist-dir'],
        outputDir: values['output-dir'],
        skipBuild: !!values['skip-build'],
        skipIntel: !!values['skip-intel'],
        build: !!values.build,
        skipSubset: !!(
            values['skip-subset'] ||
            values['skip-subset-fonts'] ||
            env.SKIP_SUBSET_FONTS === '1'
        ),
        skipOg: !!(values['skip-og'] || values['skip-seo-og']),
        dryRun: !!values['dry-run'],
        sourceOnly: !!values['source-only'],
    };
};

const distPath = (runner, options, target) =>
    path.resolve(runner.root, options.distDir || `dist/${targets[target]}`);
const appNames = (options) =>
    options.app
        ? [options.app]
        : Object.keys(apps).filter(
              (name) => !options.skipIntel || name !== 'intel',
          );
const targetNames = (options) =>
    options.target === 'all' ? Object.keys(targets) : [options.target];
const targetEnv = (options, target) => ({
    BUILD_TARGET: targets[target],
    DEPLOY_CHANNEL: options.channel,
    VITE_AUTH_BASE: `https://api.opendfieldmap.${target === 'cn' ? 'cn' : 'org'}`,
    SEO_SKIP_OG_UPLOAD: options.skipOg ? '1' : '0',
});

const verifyBuildOutput = async (runner, options, target) => {
    const dir = distPath(runner, options, target);
    await runner.local(`check build destinations for ${target}`, async () => {
        await verifyOutput(runner.root, dir);
        for (const name of appNames(options))
            await verifyOutput(runner.root, path.join(dir, apps[name]));
    });
};

const fonts = async (runner, options) => {
    if (options.skipSubset) return;
    for (const name of appNames(options)) {
        await runner.run(
            'python3',
            ['./scripts/subset-fonts.py'],
            {},
            name === 'main'
                ? runner.root
                : path.join(runner.root, 'apps', name),
        );
    }
};

const prepare = async (runner, options) => {
    for (const target of targetNames(options)) {
        await verifyBuildOutput(runner, options, target);
    }
    if (appNames(options).includes('main')) await dataTask(runner, 'prepare');
    if (appNames(options).includes('intel')) await dataTask(runner, 'intel');
    await fonts(runner, options);
};

const buildSite = async (runner, options, target) => {
    await verifyBuildOutput(runner, options, target);
    const dir = distPath(runner, options, target);
    const env = targetEnv(options, target);
    const resources = await runner.local(
        `resolve ${target}/${options.channel} resources`,
        () => resourceConfig(runner.root, runner.env, options, target),
    );
    // A failed or partial rebuild must not leave a previous full-site receipt valid.
    await runner.local(`invalidate ${path.join(dir, receipt)}`, () =>
        fs.rm(path.join(dir, receipt), { force: true }),
    );
    for (const name of appNames(options)) {
        const args =
            name === 'main'
                ? [
                      'exec',
                      'vite',
                      'build',
                      '--logLevel',
                      'warn',
                      '--outDir',
                      dir,
                  ]
                : [
                      '--filter',
                      `@atlos/${name}`,
                      'exec',
                      'vite',
                      'build',
                      '--logLevel',
                      'warn',
                      '--outDir',
                      path.join(dir, apps[name]),
                  ];
        await runner.run('pnpm', args, {
            ...env,
            NODE_ENV: 'production',
            BUILD_OUT_DIR: dir,
            ...(name === 'user-hub' && runner.env.VITE_AUTH_BASE
                ? { VITE_AUTH_BASE: runner.env.VITE_AUTH_BASE }
                : {}),
        });
        if (name === 'main')
            await runner.run('node', ['./scripts/build-seo-pages.mjs'], {
                ...env,
                SEO_PUBLIC_OUT_DIR: dir,
                SEO_WRITE_ALL_POINT_FILES: '1',
                SEO_FORCE_POINT_FILES: '1',
                SEO_SKIP_IMAGES: '1',
            });
    }
    if (!options.app)
        await runner.local(
            `record and verify ${target}/${options.channel} full-site artifact`,
            async () => {
                const source = execFileSync('git', ['rev-parse', 'HEAD'], {
                    cwd: runner.root,
                    encoding: 'utf8',
                }).trim();
                const sourceDirty = !!execFileSync(
                    'git',
                    ['status', '--porcelain'],
                    { cwd: runner.root, encoding: 'utf8' },
                ).trim();
                await fs.writeFile(
                    path.join(dir, receipt),
                    `${JSON.stringify({ target, channel: options.channel, source, sourceDirty, apps: appNames(options), resources, sourceOnly: !!options.sourceOnly, builtAt: new Date().toISOString() }, null, 2)}\n`,
                );
                try {
                    await verifyArtifact(dir, options, target);
                } catch (error) {
                    await fs.rm(path.join(dir, receipt), { force: true });
                    throw error;
                }
            },
        );
};

const og = async (runner, options, target) => {
    const env = {
        ...targetEnv(options, target),
        SEO_OG_OUTPUT_DIR: `../seo-og/${targets[target]}`,
    };
    if (options.action === 'publish') {
        await runner.run(
            'node',
            [`./scripts/publish-seo-og-${target === 'cn' ? 'OSS' : 'R2'}.js`],
            env,
        );
    } else {
        await runner.run('node', ['./scripts/build-seo-pages.mjs'], {
            ...env,
            SEO_IMAGE_ONLY: '1',
            SEO_OG_REFRESH_STATE_ONLY: options.action === 'refresh' ? '1' : '0',
        });
    }
};

const packagePages = async (runner, options) => {
    await runner.run(
        'node',
        [
            './scripts/package-pages.mjs',
            '--target',
            'org',
            '--channel',
            options.channel,
            '--dist-dir',
            distPath(runner, options, 'org'),
            ...(options.outputDir ? ['--output-dir', options.outputDir] : []),
            ...(options.skipIntel ? ['--skip-intel'] : []),
        ],
        targetEnv(options, 'org'),
    );
};

const publish = async (runner, options, target) => {
    const dir = distPath(runner, options, target);
    await runner.local(
        `verify ${target}/${options.channel} full-site artifact in ${dir}`,
        async () => {
            const info = await verifyArtifact(dir, options, target);
            if (!['server', 'pages'].includes(options.only)) {
                const resources = await resourceConfig(
                    runner.root,
                    runner.env,
                    options,
                    target,
                );
                if (
                    JSON.stringify(resources) !== JSON.stringify(info.resources)
                )
                    throw new Error(
                        'Artifact resource destination differs from the current configuration. Rebuild or restore the matching publishing configuration.',
                    );
            }
        },
    );
    const env = { ...targetEnv(options, target), DIST_DIR: dir };
    if (target === 'cn') {
        if (options.only === 'oss')
            await runner.run('node', ['./scripts/publish-oss.js'], env);
        else
            await runner.run(
                'bash',
                [
                    './scripts/deploy-cn-server.sh',
                    '--skip-build',
                    '--dist-dir',
                    dir,
                    ...(options.only === 'server' ? ['--server-only'] : []),
                ],
                env,
            );
    } else {
        if (options.only !== 'pages')
            await runner.run('node', ['./scripts/publish-R2.js'], {
                ...env,
                R2_UPLOAD_PROFILE:
                    options.only === 'resources' ? 'resources' : 'full',
            });
        if (['all', 'pages'].includes(options.only)) {
            await packagePages(runner, options);
            const config = pagesConfig[options.channel];
            await runner.run(
                'pnpm',
                [
                    'exec',
                    'wrangler',
                    'pages',
                    'deploy',
                    `.pages-dist/org-${options.channel}`,
                    '--project-name',
                    config.project,
                    '--branch',
                    config.branch,
                ],
                env,
            );
        }
    }
};

// allSettled waits for both sites before reporting partial success or deploying the shared Worker.
const sitePipelines = async (options, action) => {
    const names = targetNames(options);
    const results = await Promise.allSettled(names.map(action));
    results.forEach((result, index) =>
        console.log(
            `[${options.command}] ${names[index]}: ${result.status === 'fulfilled' ? 'succeeded' : result.reason.message}`,
        ),
    );
    if (results.some((result) => result.status === 'rejected'))
        throw new AggregateError(
            results
                .filter((result) => result.status === 'rejected')
                .map((result) => result.reason),
            `${options.command} failed; see site results above.`,
        );
};

export const runTask = async (argv, dependencies = {}) => {
    const options = parseTask(argv, dependencies.env);
    if (options.command === 'help') {
        console.log(help);
        return;
    }
    const runner = createRunner({
        ...dependencies,
        env: {
            ...(dependencies.env || process.env),
            ATLOS_SOURCE_ONLY: options.sourceOnly ? '1' : '0',
        },
        dryRun: options.dryRun,
    });
    switch (options.command) {
        case 'build':
        case 'deploy':
            await prepare(runner, options);
            if (options.command === 'deploy' && !options.skipOg) {
                for (const target of targetNames(options))
                    await og(runner, { ...options, action: 'build' }, target);
            }
            await sitePipelines(options, async (target) => {
                await buildSite(runner, options, target);
                if (options.command === 'deploy')
                    await publish(runner, options, target);
            });
            if (options.command === 'deploy' && options.target === 'all')
                await runner.run('pnpm', [
                    '--filter',
                    'oem-relink',
                    'run',
                    'deploy',
                ]);
            break;
        case 'publish':
            await publish(runner, options, options.target);
            break;
        case 'package':
            if (!options.skipBuild) {
                await prepare(runner, options);
                await buildSite(runner, options, options.target);
            }
            await runner.local('verify package source artifact', () =>
                verifyArtifact(
                    distPath(runner, options, options.target),
                    options,
                    options.target,
                ),
            );
            if (options.format === 'pages') await packagePages(runner, options);
            else
                await runner.run(
                    'node',
                    [
                        './scripts/package-dist.mjs',
                        '--skip-build',
                        '--target',
                        options.target,
                        '--channel',
                        options.channel,
                        '--dist-dir',
                        distPath(runner, options, options.target),
                        ...(options.outputDir
                            ? ['--output-dir', options.outputDir]
                            : []),
                        ...(options.skipIntel ? ['--skip-intel'] : []),
                    ],
                    targetEnv(options, options.target),
                );
            break;
        case 'og':
            for (const target of targetNames(options))
                await og(runner, options, target);
            break;
        case 'worker':
            if (options.positionals[0] === 'relink')
                await dataTask(runner, 'relink-preview');
            await runner.run('pnpm', [
                '--filter',
                `oem-${options.positionals[0]}`,
                'run',
                options.positionals[1] === 'check' ? 'type-check' : 'deploy',
            ]);
            break;
        case 'data':
            if (options.positionals[0] === 'fonts')
                await fonts(runner, {
                    app: options.app === 'all' ? undefined : options.app,
                });
            else await dataTask(runner, options.positionals[0]);
            break;
        case 'check':
            if (options.build) await dataTask(runner, 'prepare');
            await check(runner, options.build);
            if (options.build) {
                await fonts(runner, options);
                await sitePipelines({ ...options, target: 'all' }, (target) =>
                    buildSite(runner, options, target),
                );
            }
            break;
        case 'type-check':
            await typeCheck(runner, options.app);
            break;
        case 'test':
            await test(runner, options.app);
            break;
        case 'lint':
        case 'lint:fix':
            await lint(runner, options.command === 'lint:fix');
            break;
    }
};

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    runTask(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

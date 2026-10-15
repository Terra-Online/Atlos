import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './task-runner.mjs';

// Include tracked files and new non-ignored files, so local scratch files and
// generated assets do not make checks differ from a fresh checkout.
export const projectFiles = () =>
    [
        ...new Set(
            execFileSync(
                'git',
                [
                    'ls-files',
                    '-z',
                    '--cached',
                    '--others',
                    '--exclude-standard',
                ],
                { cwd: ROOT, encoding: 'utf8' },
            ).split('\0'),
        ),
    ].filter((file) => file && existsSync(path.join(ROOT, file)));

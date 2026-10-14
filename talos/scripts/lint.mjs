import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import { projectFiles } from './project-files.mjs';
import { ROOT } from './task-runner.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--fix'))
    throw new Error('Use lint.mjs [--fix].');
const fix = args.includes('--fix');
const files = projectFiles();
const eslint = new ESLint({ cwd: ROOT, fix, warnIgnored: false });
const scripts = files.filter((file) =>
    /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(file),
);
const results = await eslint.lintFiles(scripts);
if (fix) await ESLint.outputFixes(results);
const formatter = await eslint.loadFormatter('stylish');
const report = formatter.format(results);
if (report) console.log(report);
const errors = results.reduce((total, result) => total + result.errorCount, 0);
const warnings = results.reduce(
    (total, result) => total + result.warningCount,
    0,
);
console.log(
    `[eslint] ${results.length} files; ${errors} errors, ${warnings} warnings`,
);

const styles = files.filter((file) =>
    /^(?:src|apps\/[^/]+\/src)\/.*\.(?:css|scss)$/.test(file),
);
const css = styles.length
    ? await stylelint.lint({
          cwd: ROOT,
          files: styles,
          fix,
          formatter: 'string',
      })
    : undefined;
if (css?.report) console.log(css.report);
console.log(
    `[stylelint] ${styles.length} files; ${css?.errored ? 'failed' : 'passed'}`,
);
if (errors || css?.errored) process.exitCode = 1;

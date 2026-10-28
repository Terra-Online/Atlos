import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function distribution(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const rank = (q) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
    return { n: sorted.length, min: sorted[0], p50: rank(.5), p95: rank(.95), max: sorted.at(-1) };
}
const fmt = (value) => Number.isFinite(value) ? value.toFixed(1) : '—';
const mb = (value) => (value / 1024 / 1024).toFixed(2);
const group = (rows, key) => {
    const groups = new Map();
    for (const row of rows) { const name = key(row); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(row); }
    return groups;
};

export async function writeProductionReport(directory) {
    const root = resolve(directory);
    const report = JSON.parse(await readFile(resolve(root, 'runtime.json'), 'utf8'));
    if (report.errors.length) throw new Error('Cannot accept a baseline with runtime errors.');
    const expected = report.method.rounds * report.method.workloads * 2;
    if (report.startup.length !== expected || report.memory.length !== report.method.rounds * report.method.workloads)
        throw new Error('Incomplete startup/memory workload.');
    const summary = { source: report.source, environment: report.environment, method: report.method,
        startup: [], interactions: [], memory: [], bundles: [] };
    const lines = ['# 生产构建性能基线', '', `采集：${report.startedAt}；构建源码：\`${report.source}\`。`, '',
        '这是一份冻结生产产物的实验室基线，没有候选优化版本，不能从中得出优化收益。页面/服务/输入范围见 method 原始字段及上级说明。', '',
        '## 首个可用元素', '',
        '时间在浏览器 MutationObserver 与双 rAF 内采集；下表为 ms。冷启动指全新隔离上下文，再次导航指同上下文 reload。服务拦截禁用 HTTP 缓存，因此再次导航不是暖 HTTP/CDN 缓存。移动组为 4 倍 CPU 节流，不能当真机成绩。每组仅5轮，p95采用最近秩，通常等于最大值；不是稳定SLA。', '',
        '| App / 环境 / 导航 | n | 可用首帧 p50 / p95 | FCP p50 | LCP 快照 p50 | CLS 快照 p50 | JS 执行 p50 |',
        '| --- | --- | --- | --- | --- | --- | --- |'];
    for (const [key, rows] of group(report.startup, (row) => `${row.app} / ${row.profile} / ${row.visit}`)) {
        const row = { key, readyFrame: distribution(rows.map((r) => r.readyFrame)),
            fcp: distribution(rows.map((r) => r.paints.find((p) => p.name === 'first-contentful-paint')?.startTime)),
            lcp: distribution(rows.map((r) => r.lcp)), cls: distribution(rows.map((r) => r.cls)),
            script: distribution(rows.map((r) => r.cpu.ScriptDuration)),
            resourceBytes: distribution(rows.map((r) => r.resources.reduce((n, x) => n + x.decoded, 0))),
            resourceCount: distribution(rows.map((r) => r.resources.length)),
            fontBytes: distribution(rows.map((r) => r.resources.filter((x) => /\.(woff2?|otf|ttf)$/.test(x.path)).reduce((n, x) => n + x.decoded, 0))),
            sampleBoundary: distribution(rows.map((r) => r.sampledAt)) };
        summary.startup.push(row);
        lines.push(`| ${key} | ${row.readyFrame.n} | ${fmt(row.readyFrame.p50)} / ${fmt(row.readyFrame.p95)} | ${fmt(row.fcp?.p50)} | ${fmt(row.lcp?.p50)} | ${row.cls?.p50.toFixed(4)} | ${fmt(row.script.p50)} |`);
    }
    lines.push('', '首帧只保证指定操作入口已出现，不代表全部地图切片、图像或所有后台任务结束。LCP/CLS取 ready 且至少2秒后的实际采样边界；各轮 sampledAt 均保留，不冒称最终字段Web Vitals。传输使用本机未压缩响应，资源 decoded bytes 与原始请求在runtime.json中，不能当线上下载耗时。', '',
        '## 交互与自然帧', '', '总耗时包含浏览器自动化指令、等待过渡/滚动终点，适合同条件回归对照，不是字段 INP。每次动作保存原始rAF时间及支持引擎的长任务；WebKit不支持Long Tasks API时明确标记，不填0冒称无长任务。', '',
        '| App / 环境 / 动作 | n | 操作总时长 p50 / p95 | 每次最大帧间隔 p50 / p95 |', '| --- | --- | --- | --- |');
    for (const [key, rows] of group(report.interactions.filter((row) => !row.diagnostic), (row) => `${row.app} / ${row.profile} / ${row.label}`)) {
        const row = { key, duration: distribution(rows.map((r) => r.driverInclusiveMs)), maxFrameGap: distribution(rows.map((r) => r.maxFrameGap)) };
        summary.interactions.push(row);
        lines.push(`| ${key} | ${row.duration.n} | ${fmt(row.duration.p50)} / ${fmt(row.duration.p95)} | ${fmt(row.maxFrameGap?.p50)} / ${fmt(row.maxFrameGap?.p95)} |`);
    }
    lines.push('', '## 操作前后内存', '', '同一页面执行3轮路径后显式GC；各环境5个独立上下文。下面是每轮 CDP Runtime.getHeapUsage.usedSize 的 after−before；DOM统计包括当前浏览器文档。正值不能单独证明泄漏，需要更长时间与分配栈归因；显式GC样本也不代表用户真实回收时机。', '',
        '| App / 环境 | n | JS heap 差值 MiB p50 / p95 | DOM node 差值 p50 / p95 |', '| --- | --- | --- | --- |');
    for (const [key, rows] of group(report.memory, (row) => `${row.app} / ${row.profile}`)) {
        const row = { key, heapDelta: distribution(rows.map((r) => r.after.heap.usedSize - r.before.heap.usedSize)),
            nodeDelta: distribution(rows.map((r) => r.after.dom.nodes - r.before.dom.nodes)) };
        summary.memory.push(row);
        lines.push(`| ${key} | ${row.heapDelta.n} | ${mb(row.heapDelta.p50)} / ${mb(row.heapDelta.p95)} | ${row.nodeDelta.p50} / ${row.nodeDelta.p95} |`);
    }
    lines.push('', '## 构建体积与模块组成', '', '体积仅含打包的JS/CSS；地图切片/字体/图像/SEO分别属于资源，不混入应用JS。gzip为默认参数，Brotli质量11，均逐文件压缩；表中总量包含所有语言/动态模块，不能当首屏传输量。模块renderedLength来自Rollup最终chunk压缩前输出，不代表压缩后的精确归因。', '',
        '| App | JS/CSS文件 | 原始 MiB | gzip MiB | Brotli MiB | 静态入口图JS gzip KiB |', '| --- | --- | --- | --- | --- | --- |');
    for (const bundle of report.bundles || []) {
        const row = { app: bundle.app, files: bundle.files.length, raw: 0, gzip: 0, brotli: 0, entries: [], packages: [] };
        const packages = new Map();
        for (const file of bundle.files) {
            for (const size of ['raw', 'gzip', 'brotli']) row[size] += file[size];
            if (file.entry) row.entries.push({ file: file.file, raw: file.raw, gzip: file.gzip, imports: file.imports });
            for (const module of file.modules || []) {
                const boundary = module.id.lastIndexOf('node_modules/');
                const dependency = module.id.slice(boundary + 'node_modules/'.length);
                const name = boundary >= 0 ? dependency.split('/').slice(0, dependency.startsWith('@') ? 2 : 1).join('/')
                    : /(?:^|\/)data\//.test(module.id) || module.id.endsWith('.json') ? 'application-data' : 'application-code';
                packages.set(name, (packages.get(name) || 0) + module.renderedLength);
            }
        }
        const files = new Map(bundle.files.map((file) => [file.file, file]));
        const initial = new Set();
        const visit = (name) => {
            if (initial.has(name)) return;
            const file = files.get(name);
            if (!file) return;
            initial.add(name);
            for (const dependency of file.imports || []) visit(dependency);
        };
        row.entries.forEach((entry) => visit(entry.file));
        row.initialJS = { files: [...initial], gzip: [...initial].reduce((total, name) => total + files.get(name).gzip, 0) };
        row.packages = [...packages].map(([name, renderedLength]) => ({ name, renderedLength })).sort((a, b) => b.renderedLength - a.renderedLength);
        summary.bundles.push(row);
        lines.push(`| ${row.app} | ${row.files} | ${mb(row.raw)} | ${mb(row.gzip)} | ${mb(row.brotli)} | ${(row.initialJS.gzip / 1024).toFixed(1)} |`);
    }
    for (const app of summary.bundles) lines.push('', `### ${app.app}：Rollup模块输出前8项`, '', ...app.packages.slice(0, 8).map((row) => `- ${row.name}: ${(row.renderedLength / 1024).toFixed(1)} KiB`));
    lines.push('', '## 后续分析入口', '', '根据实际帧分布、长任务、初始资源与模块图挑选单一假设；本轮不修改产品性能策略。WebKit自然帧空档、移动节流下的Intel测量/滚动、重复操作的GC后堆差值均应结合原始记录进一步归因。截图只是可复查布局，诊断trace若开启则独立采集，不混入计时分布。', '');
    await writeFile(resolve(root, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    await writeFile(resolve(root, 'report.md'), lines.join('\n'));
    return summary;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    if (!process.argv[2]) throw new Error('Provide a baseline report directory.');
    await writeProductionReport(process.argv[2]);
}

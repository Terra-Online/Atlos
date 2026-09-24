import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const akeData = path.resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith('--'))
    ?? '/Users/canvas/_Code/Preview Repos/AKEData',
);
const checkOnly = process.argv.includes('--check');
const tableDir = path.join(akeData, 'TableCfg');
const textDir = path.join(root, 'public/files/text');
const locales = {
  'de-DE': 'DE', 'en-US': 'EN', 'es-ES': 'MX', 'fr-FR': 'FR',
  'id-ID': 'ID', 'it-IT': 'IT', 'ja-JP': 'JP', 'ko-KR': 'KR',
  'pt-BR': 'BR', 'pt-PT': 'BR', 'ru-RU': 'RU', 'th-TH': 'TH',
  'vi-VN': 'VN', 'zh-CN': 'CN', 'zh-TW': 'TC',
};

const readJson = async (file, exactIds = false) => JSON.parse(
  await fs.readFile(file, 'utf8'),
  exactIds ? (key, value, context) => (
    key === 'id' && typeof value === 'number' ? context.source : value
  ) : undefined,
);

const normalizeContent = (content) => content
  .replace(/\r\n?/g, '\n')
  .replace(/<@nar\.key>(.*?)<\/>/gs, '<span class="keyword">$1</span>')
  .replace(/<@nar\.quote>(.*?)<\/>/gs, '<i>$1</i>')
  .replace(/<@nar\.(?:mark|left|right)>(.*?)<\/>/gs, '$1')
  .replace(/<@nar\.enter><\/>/g, '\n')
  .replace(/<s>(.*?)<\/s>/gs, '<del>$1</del>')
  .replace(/<image>(.*?)<\/image>/gs, (_, raw) => {
    const name = path.posix.basename(raw.trim());
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid archive image: ${raw}`);
    return `<img src="files/images/${name}" alt="${name}" />`;
  })
  .replace(/<\/>/g, '')
  .replace(/\n+/g, '\n')
  .trim();

const [manifest, allItems, richContent, radioTable] = await Promise.all([
  readJson(path.join(root, 'src/data/files.json')),
  readJson(path.join(tableDir, 'PrtsAllItem.json'), true),
  readJson(path.join(tableDir, 'RichContentTable.json'), true),
  readJson(path.join(tableDir, 'RadioTable.json'), true),
]);

const archiveIds = Object.keys(manifest.files.archives);
const documents = archiveIds.map((id) => ({
  id,
  contentId: allItems[id]?.contentId,
  titleId: allItems[id]?.name?.id,
}));

let created = 0;
let refreshed = 0;
const unresolved = [];
for (const [locale, language] of Object.entries(locales)) {
  const translations = await readJson(path.join(tableDir, `I18nTextTable_${language}.json`));
  await fs.mkdir(path.join(textDir, locale), { recursive: true });

  for (const document of documents) {
    const target = path.join(textDir, locale, `${document.id}.json`);
    let previous;
    try {
      previous = await readJson(target);
    } catch {
      // Missing documents are generated below.
    }

    const rich = richContent[document.contentId];
    const radio = radioTable[document.contentId];
    if (!rich && !radio) {
      unresolved.push(`${locale}/${document.id}: missing content source`);
      continue;
    }
    const title = previous?.title || translations[document.titleId] || translations[rich?.title?.id];
    const parts = rich
      ? (rich.contentList ?? []).map((entry) => translations[entry.content?.id])
      : (radio.radioSingleDataList ?? []).map((entry) => {
        const line = translations[entry.radioText?.id];
        if (typeof line !== 'string') return undefined;
        const actor = (translations[entry.actorName?.id] ?? '')
          .replace(/\{[^{}]*\}/g, '').replace(/\s+/g, ' ').trim();
        return actor ? `<span class="actor">${actor}</span>${line}` : line;
      });
    if (!title || parts.length === 0 || parts.some((part) => typeof part !== 'string')) {
      unresolved.push(`${locale}/${document.id}: missing translation`);
      continue;
    }
    const content = normalizeContent(parts.join('\n'));
    if (!content) {
      unresolved.push(`${locale}/${document.id}: empty content`);
      continue;
    }
    if (previous?.title === title && previous?.content === content) continue;
    if (!checkOnly) await fs.writeFile(target, `${JSON.stringify({ title, content }, null, 2)}\n`);
    if (previous) refreshed++;
    else created++;
  }
}

console.log(`[sync-archive-text] ${checkOnly ? 'would write' : 'wrote'} ${created} new and ${refreshed} refreshed documents; unresolved ${unresolved.length}`);
for (const issue of unresolved) console.error(issue);
if (unresolved.length) process.exitCode = 1;

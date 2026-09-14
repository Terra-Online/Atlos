import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeArchiveContract } from '../apps/intel/src/data/archiveContract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE = path.resolve(ROOT, '../../endfield-bots/intels');
const DATA_OUTPUT = path.resolve(ROOT, 'apps/intel/src/data/generated');
const I18N_OUTPUT = path.resolve(ROOT, 'apps/intel/src/locale/data/game');
const IMAGE_OUTPUT = path.resolve(ROOT, 'apps/intel/src/assets/archive-icons');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const equal = args.find((arg) => arg.startsWith(`${name}=`));
  if (equal) return equal.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const source = path.resolve(ROOT, argValue('--source', DEFAULT_SOURCE));
const readJson = (file) => fs.readJson(path.resolve(source, file));
const writeJson = async (file, value) => {
  const target = path.resolve(DATA_OUTPUT, file);
  await fs.ensureDir(path.dirname(target));
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
};
const sourceContract = await readJson('archive_contract.json');
const archives = decodeArchiveContract(sourceContract);
await writeJson('archive_contract.json', sourceContract);

const syncDirectory = async (sourceDirectory, targetDirectory, extension) => {
  const sourcePath = path.resolve(source, sourceDirectory);
  const files = (await fs.readdir(sourcePath)).filter((file) => file.endsWith(extension)).sort();
  await fs.emptyDir(targetDirectory);
  await Promise.all(files.map((file) => fs.copy(
    path.resolve(sourcePath, file),
    path.resolve(targetDirectory, file),
  )));
  return files.length;
};
const [localeCount, iconCount] = await Promise.all([
  syncDirectory('i18n', I18N_OUTPUT, '.json'),
  syncDirectory('images/webp', IMAGE_OUTPUT, '.webp'),
]);

console.log(`[sync-intel-data] copied ${archives.length} archive rows, ${localeCount} locales, ${iconCount} icons`);

import fs from 'node:fs/promises';

export async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

export async function safeReadJson(file, fallback = null) {
  try {
    return await readJson(file);
  } catch {
    return fallback;
  }
}

export async function safeReaddir(dir) {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

export async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

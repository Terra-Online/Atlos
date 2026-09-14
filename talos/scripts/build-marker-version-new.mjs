import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const markerRoot = path.join(root, 'src/data/marker');
const dataDir = path.join(markerRoot, 'data');
const logDir = path.join(root, 'scripts/logs/marker-version-new');
const outputPath = path.join(markerRoot, 'diff.generated.json');
const typePath = path.join(markerRoot, 'type.json');

const VERSION_NEW_BUILD_CONFIG = {
  snapshot: {
    version: '1.5',
    source: 'current',
  },
  from: '1.4',
  to: 'current',
  toLabel: '1.5',
  include: [
    'collection.*',
    'exploration.*',
    'archives.*',
    'natural.originium_spot',
    'natural.cuprium_spot',
    'natural.ferrium_spot',
    'natural.amethyst_spot',
    'natural.inergen_spot',
    'natural.xiragen_spot'
  ],
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const normalizeRawMarker = (raw) => {
  if (Array.isArray(raw)) {
    return {
      id: raw[0],
      type: raw[5],
    };
  }
  return raw;
};

const normalizeRuleToken = (value) =>
  String(value).trim().toLowerCase().replace(/\s+/g, '_');

const markerTypePaths = (typeInfo) => {
  const key = normalizeRuleToken(typeInfo.key);
  const main = normalizeRuleToken(typeInfo.category?.main ?? '');
  const sub = normalizeRuleToken(typeInfo.category?.sub ?? '');

  return [
    [key],
    [sub, key],
    [main, sub, key],
  ];
};

const ruleMatchesPath = (rule, markerPath) => {
  const parts = String(rule).split('.').map(normalizeRuleToken).filter(Boolean);
  if (parts.length !== markerPath.length) return false;
  return parts.every((part, index) => part === '*' || part === markerPath[index]);
};

const ruleMatchesType = (rule, typeInfo) =>
  markerTypePaths(typeInfo).some((markerPath) => ruleMatchesPath(rule, markerPath));

const listJsonFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

const readMarkerDirectory = (dir) => {
  const markers = new Map();

  for (const file of listJsonFiles(dir)) {
    const items = readJson(path.join(dir, file));
    for (const raw of items) {
      const marker = normalizeRawMarker(raw);
      const id = marker?.id == null ? '' : String(marker.id);
      const type = marker?.type == null ? '' : String(marker.type);
      if (id && type) markers.set(id, type);
    }
  }

  return markers;
};

const writeJson = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

const loadSnapshotFile = (filePath) => {
  const snapshot = readJson(filePath);
  const markers = new Map();
  for (const item of snapshot.markers ?? []) {
    if (!Array.isArray(item)) continue;
    const [id, type] = item;
    if (id != null && type) markers.set(String(id), String(type));
  }
  return markers;
};

const markerMapToSnapshot = (version, source, markers) => ({
  version,
  source,
  markers: Array.from(markers.entries()).sort(([a], [b]) => a.localeCompare(b)),
});

const resolveSourceDirectory = (source) => {
  if (source === 'current') return dataDir;
  return path.join(dataDir, source);
};

const snapshotPathFor = (version) => path.join(logDir, `${version}.snapshot.json`);

const readSnapshotByVersion = (version) => {
  const snapshotPath = snapshotPathFor(version);
  if (!fs.existsSync(snapshotPath)) return null;
  return loadSnapshotFile(snapshotPath);
};

const loadRef = (ref) => {
  const snapshot = readSnapshotByVersion(ref);
  if (snapshot) {
    return snapshot;
  }

  const sourceDir = resolveSourceDirectory(ref);
  if (fs.existsSync(sourceDir) && fs.statSync(sourceDir).isDirectory()) {
    return readMarkerDirectory(sourceDir);
  }

  throw new Error(`Cannot resolve marker snapshot "${ref}"`);
};

const ensureSnapshot = ({ version, source }) => {
  const markers = loadRef(source);
  const snapshotPath = snapshotPathFor(version);
  writeJson(snapshotPath, markerMapToSnapshot(version, source, markers));
  console.log(`[marker-version-new] wrote ${path.relative(root, snapshotPath)}`);
  return markers;
};

const typeDict = readJson(typePath);
if (VERSION_NEW_BUILD_CONFIG.snapshot) {
  ensureSnapshot(VERSION_NEW_BUILD_CONFIG.snapshot);
}
const from = String(VERSION_NEW_BUILD_CONFIG.from);
const to = String(VERSION_NEW_BUILD_CONFIG.to);
const toLabel = String(VERSION_NEW_BUILD_CONFIG.toLabel ?? to);

const before = loadRef(from);
const after = loadRef(to);
if (VERSION_NEW_BUILD_CONFIG.snapshot?.version !== toLabel) {
  const nextSnapshotPath = snapshotPathFor(toLabel);
  writeJson(nextSnapshotPath, markerMapToSnapshot(toLabel, to, after));
  console.log(`[marker-version-new] wrote ${path.relative(root, nextSnapshotPath)}`);
}

const markerIdsByType = new Map();
for (const [id, type] of after.entries()) {
  if (before.has(id)) continue;
  const typeInfo = typeDict[type];
  if (!typeInfo) continue;
  if (!VERSION_NEW_BUILD_CONFIG.include.some((rule) => ruleMatchesType(rule, { ...typeInfo, key: type }))) continue;
  if (!markerIdsByType.has(type)) markerIdsByType.set(type, []);
  markerIdsByType.get(type).push(id);
}

const rows = Array.from(markerIdsByType.entries())
  .map(([type, ids]) => [type, ...ids.sort((a, b) => a.localeCompare(b)), ids.length])
  .sort(([a], [b]) => String(a).localeCompare(String(b)));

writeJson(outputPath, {
  from: [from, before.size],
  to: [toLabel, after.size],
  types: rows,
});
console.log(`[marker-version-new] wrote ${path.relative(root, outputPath)}`);

const githubToken = process.env.GITHUB_TOKEN;
const crowdinToken = process.env.CROWDIN_PERSONAL_TOKEN;
const projectId = process.env.CROWDIN_PROJECT_ID;
const repository = process.env.GITHUB_REPOSITORY;

const baseBranch = process.env.CROWDIN_PR_BASE ?? "main";
const headBranch = process.env.CROWDIN_PR_HEAD ?? "l10n/crowdin";
const crowdinBranch = process.env.CROWDIN_BRANCH ?? "main";
const sourcePath =
  process.env.CROWDIN_SOURCE_PATH ??
  "talos/src/locale/data/ui/en-US.json";
const localeDirectory = "talos/src/locale/data/ui/";
const markerStart = "<!-- crowdin-contributors:start -->";
const markerEnd = "<!-- crowdin-contributors:end -->";

for (const [name, value] of Object.entries({
  GITHUB_TOKEN: githubToken,
  CROWDIN_PERSONAL_TOKEN: crowdinToken,
  CROWDIN_PROJECT_ID: projectId,
  GITHUB_REPOSITORY: repository,
})) {
  if (!value) throw new Error(`${name} is required`);
}

const [owner, repo] = repository.split("/");
if (!owner || !repo) throw new Error("GITHUB_REPOSITORY must be owner/repo");

async function request(url, token, init = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "oem-automata-crowdin-attribution",
        ...init.headers,
      },
    });

    if (response.ok) {
      return response.status === 204 ? null : response.json();
    }

    const detail = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 2) {
      throw new Error(`${response.status} ${response.statusText}: ${detail}`);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter)
      ? retryAfter * 1_000
      : 1_000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function github(path, init) {
  return request(`https://api.github.com${path}`, githubToken, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  });
}

function crowdin(path) {
  return request(`https://api.crowdin.com/api/v2${path}`, crowdinToken, {
    headers: { Accept: "application/json" },
  });
}

async function crowdinList(path, params = {}) {
  const values = [];
  const limit = 500;

  for (let offset = 0; ; offset += limit) {
    const query = new URLSearchParams({
      ...params,
      limit: String(limit),
      offset: String(offset),
    });
    const separator = path.includes("?") ? "&" : "?";
    const response = await crowdin(`${path}${separator}${query}`);
    const page = response.data.map((entry) => entry.data);
    values.push(...page);
    if (page.length < limit) return values;
  }
}

async function githubList(path) {
  const values = [];
  const limit = 100;

  for (let page = 1; ; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const items = await github(
      `${path}${separator}per_page=${limit}&page=${page}`,
    );
    values.push(...items);
    if (items.length < limit) return values;
  }
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function readJson(path, ref) {
  const response = await github(
    `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
  );
  if (response.type !== "file" || response.encoding !== "base64") {
    throw new Error(`Cannot read ${path} at ${ref}`);
  }
  return JSON.parse(Buffer.from(response.content, "base64").toString("utf8"));
}

function flattenStrings(value, prefix = "", result = new Map()) {
  if (typeof value === "string") {
    result.set(prefix, value);
    return result;
  }

  if (!value || typeof value !== "object") return result;

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    flattenStrings(child, path, result);
  }

  return result;
}

function resolveLanguage(locale, targetLanguageIds) {
  const exact = targetLanguageIds.find(
    (languageId) => languageId.toLowerCase() === locale.toLowerCase(),
  );
  if (exact) return exact;

  const matches = targetLanguageIds.filter((languageId) =>
    locale.toLowerCase().startsWith(`${languageId.toLowerCase()}-`),
  );
  return matches.length === 1 ? matches[0] : null;
}

function escapeMarkdown(value) {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function upsertBlock(body, block) {
  const start = body.indexOf(markerStart);
  const end = body.indexOf(markerEnd);
  if (start !== -1 && end > start) {
    return `${body.slice(0, start)}${block}${body.slice(end + markerEnd.length)}`;
  }
  return `${body.trimEnd()}\n\n${block}\n`;
}

const pullRequests = await github(
  `/repos/${owner}/${repo}/pulls?state=open&base=${encodeURIComponent(baseBranch)}&head=${encodeURIComponent(`${owner}:${headBranch}`)}`,
);
const pullRequest = pullRequests[0];

if (!pullRequest) {
  console.log("No open Crowdin pull request; skipping attribution.");
  process.exit(0);
}

const changedFiles = await githubList(
  `/repos/${owner}/${repo}/pulls/${pullRequest.number}/files`,
);
const localeFiles = changedFiles.filter(
  ({ filename, status }) =>
    status !== "removed" &&
    filename.startsWith(localeDirectory) &&
    filename.endsWith(".json") &&
    filename !== sourcePath,
);

if (localeFiles.length === 0) {
  console.log(`PR #${pullRequest.number} has no changed locale files.`);
  process.exit(0);
}

const project = (await crowdin(`/projects/${projectId}`)).data;
const files = await crowdinList(`/projects/${projectId}/files`);
const expectedSourcePath = `/${crowdinBranch}/${sourcePath}`;
const sourceFile = files.find(({ path }) => path === expectedSourcePath);
if (!sourceFile) throw new Error(`Crowdin source file not found: ${sourcePath}`);

const strings = await crowdinList(`/projects/${projectId}/strings`, {
  fileId: String(sourceFile.id),
});
const stringsByIdentifier = new Map(
  strings.map((string) => [string.identifier, string]),
);
const contributors = new Map();
let changedStringCount = 0;
let unmatchedStringCount = 0;

for (const { filename } of localeFiles) {
  const locale = filename.slice(localeDirectory.length, -".json".length);
  const languageId = resolveLanguage(locale, project.targetLanguageIds);
  if (!languageId) {
    console.warn(`Cannot map locale ${locale} to a Crowdin language.`);
    continue;
  }

  const [baseJson, headJson] = await Promise.all([
    readJson(filename, pullRequest.base.sha),
    readJson(filename, pullRequest.head.sha),
  ]);
  const baseStrings = flattenStrings(baseJson);
  const headStrings = flattenStrings(headJson);

  for (const [identifier, text] of headStrings) {
    if (baseStrings.get(identifier) === text) continue;
    changedStringCount += 1;

    const sourceString = stringsByIdentifier.get(identifier);
    if (!sourceString) {
      unmatchedStringCount += 1;
      console.warn(`Crowdin string not found: ${identifier}`);
      continue;
    }

    const translations = await crowdinList(
      `/projects/${projectId}/translations`,
      {
        stringId: String(sourceString.id),
        languageId,
      },
    );
    const matches = translations.filter((translation) => translation.text === text);
    if (matches.length === 0) {
      unmatchedStringCount += 1;
      console.warn(`Current Crowdin translation not found: ${locale}/${identifier}`);
      continue;
    }

    for (const { user } of matches) {
      const contributor = contributors.get(user.username) ?? {
        locales: new Set(),
        strings: new Set(),
      };
      contributor.locales.add(locale);
      contributor.strings.add(`${locale}:${identifier}`);
      contributors.set(user.username, contributor);
    }
  }
}

if (changedStringCount === 0) {
  console.log(`PR #${pullRequest.number} has no changed string values.`);
  process.exit(0);
}

const lines = [...contributors.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([username, { locales, strings: contributedStrings }]) => {
    const profile = `https://crowdin.com/profile/${encodeURIComponent(username)}`;
    const languages = [...locales].sort().join(", ");
    const count = contributedStrings.size;
    return `- [${escapeMarkdown(username)}](${profile}) — ${languages} · ${count} ${count === 1 ? "string" : "strings"}`;
  });

if (unmatchedStringCount > 0) {
  lines.push(
    `- Attribution unavailable for ${unmatchedStringCount} changed ${unmatchedStringCount === 1 ? "string" : "strings"}.`,
  );
}

if (lines.length === 0) {
  console.log(`No Crowdin contributors matched PR #${pullRequest.number}.`);
  process.exit(0);
}

const block = [
  markerStart,
  "## Crowdin contributors",
  "",
  ...lines,
  markerEnd,
].join("\n");
const body = upsertBlock(pullRequest.body ?? "", block);

if (process.env.CROWDIN_ATTRIBUTION_DRY_RUN === "true") {
  console.log(body);
  process.exit(0);
}

await github(`/repos/${owner}/${repo}/pulls/${pullRequest.number}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ body }),
});
console.log(
  `Updated PR #${pullRequest.number} with ${contributors.size} Crowdin contributor(s).`,
);

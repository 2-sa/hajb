import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(relativePath) {
  const text = await readFile(path.join(root, relativePath), 'utf8');
  return JSON.parse(text);
}

async function assertFileExists(relativePath) {
  try {
    await access(path.join(root, relativePath));
  } catch {
    throw new Error(`Manifest references a missing file: ${relativePath}`);
  }
}

const manifest = await readJson('manifest.json');
const packageJson = await readJson('package.json');
const localeNames = ['ar', 'en'];
const locales = Object.fromEntries(await Promise.all(localeNames.map(async (locale) => [
  locale,
  await readJson(path.join('_locales', locale, 'messages.json'))
])));

invariant(manifest.manifest_version === 3, 'Only Manifest V3 is supported');
invariant(manifest.version === packageJson.version, 'manifest.json and package.json versions must match');
invariant(!manifest.host_permissions, 'Static content scripts do not need duplicate host_permissions');
invariant(
  manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required?.[0] === 'none',
  'Firefox data collection disclosure must explicitly declare none'
);
invariant(
  Number.parseFloat(manifest.browser_specific_settings?.gecko?.strict_min_version) >= 140,
  'Firefox data collection permissions require Firefox 140 or newer'
);

const referencedFiles = new Set([
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  manifest.action?.default_popup,
  ...(manifest.content_scripts ?? []).flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])])
].filter(Boolean));

const defaultLocale = locales[manifest.default_locale];
invariant(defaultLocale, `Missing default locale: ${manifest.default_locale}`);
const expectedLocaleKeys = Object.keys(defaultLocale).sort();

for (const [locale, messages] of Object.entries(locales)) {
  invariant(
    JSON.stringify(Object.keys(messages).sort()) === JSON.stringify(expectedLocaleKeys),
    `Locale ${locale} does not contain the same message keys as ${manifest.default_locale}`
  );
  for (const [key, entry] of Object.entries(messages)) {
    invariant(typeof entry.message === 'string' && entry.message.trim(), `Locale ${locale}.${key} has no message`);
  }
}

for (const field of ['name', 'short_name', 'description']) {
  const match = /^__MSG_([^_]+)__$/.exec(manifest[field]);
  invariant(match && defaultLocale[match[1]], `Manifest ${field} has an invalid or missing locale message`);
}

for (const relativePath of [...referencedFiles].filter((file) => file.endsWith('.html'))) {
  const html = await readFile(path.join(root, relativePath), 'utf8');
  invariant(!/(?:src|href)=["']https?:\/\//i.test(html), `${relativePath} contains a remote executable resource`);

  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
    const resource = match[1];
    if (resource.startsWith('#') || resource.startsWith('data:')) continue;
    referencedFiles.add(path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), resource)));
  }
}

await Promise.all([...referencedFiles].map(assertFileExists));

console.log(`Validated Manifest V${manifest.manifest_version} package ${manifest.version} (${referencedFiles.size} resources, ${localeNames.length} locales).`);

// Stops the build when a language file is missing, lacks a key, has a key English does not have,
// lists a different number of items, or has other {{placeholders}} than English. English is the
// reference. Languages: the same as the apps (app-core).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_LANGUAGES } from 'app-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { apps } = JSON.parse(fs.readFileSync(path.join(root, 'data/apps.json'), 'utf8'));
const dirs = ['i18n/common', ...apps.filter((a) => a.slug).map((a) => `i18n/apps/${a.slug}`)];
const problems = [];

/** Every leaf as path → text (arrays by index). */
function leaves(value, prefix = '', out = new Map()) {
  if (typeof value === 'string') out.set(prefix, value);
  else if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${prefix}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  else out.set(prefix, String(value));
  return out;
}
const placeholders = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');

for (const dir of dirs) {
  const en = leaves(JSON.parse(fs.readFileSync(path.join(root, dir, 'en.json'), 'utf8')));
  for (const { code } of CORE_LANGUAGES) {
    const file = path.join(root, dir, `${code}.json`);
    if (!fs.existsSync(file)) {
      problems.push(`${dir}/${code}.json is missing`);
      continue;
    }
    let other;
    try {
      other = leaves(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      problems.push(`${dir}/${code}.json: ${error.message}`);
      continue;
    }
    for (const [key, text] of en) {
      if (!other.has(key)) problems.push(`${dir}/${code}.json: missing ${key}`);
      else if (placeholders(other.get(key)) !== placeholders(text)) problems.push(`${dir}/${code}.json: ${key} has {{${placeholders(other.get(key))}}}, English {{${placeholders(text)}}}`);
      else if (code !== 'en' && !other.get(key).trim()) problems.push(`${dir}/${code}.json: ${key} is empty`);
    }
    for (const key of other.keys()) if (!en.has(key)) problems.push(`${dir}/${code}.json: ${key} is not in English`);
  }
}

if (problems.length) {
  console.error(`i18n: ${problems.length} problem(s)\n${problems.slice(0, 40).join('\n')}${problems.length > 40 ? '\n…' : ''}`);
  process.exit(1);
}
console.log(`i18n OK: ${CORE_LANGUAGES.length} languages, ${dirs.length} text sets.`);

// Stops the build when a language file is missing, lacks a key, has a key English does not have,
// lists a different number of items, or has other {{placeholders}} than English. English is the
// reference. Languages: the same as the apps (app-core). Plural keys (`name_one`, `name_other` …) are
// checked per language: exactly the forms Intl.PluralRules gives for it, each with English's placeholders.
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
const PLURAL = /_(zero|one|two|few|many|other)$/;

/** Plural keys by their base (`a.total_one` → `a.total`), and the other keys as they are. */
function split(map) {
  const plain = new Map();
  const plurals = new Map();
  for (const [key, text] of map) {
    const m = key.match(PLURAL);
    if (!m) plain.set(key, text);
    else {
      const base = key.slice(0, -m[0].length);
      if (!plurals.has(base)) plurals.set(base, new Map());
      plurals.get(base).set(m[1], text);
    }
  }
  return { plain, plurals };
}

for (const dir of dirs) {
  const { plain: en, plurals: enPlurals } = split(leaves(JSON.parse(fs.readFileSync(path.join(root, dir, 'en.json'), 'utf8'))));
  for (const { code } of CORE_LANGUAGES) {
    const file = path.join(root, dir, `${code}.json`);
    if (!fs.existsSync(file)) {
      problems.push(`${dir}/${code}.json is missing`);
      continue;
    }
    let other;
    let otherPlurals;
    try {
      ({ plain: other, plurals: otherPlurals } = split(leaves(JSON.parse(fs.readFileSync(file, 'utf8')))));
    } catch (error) {
      problems.push(`${dir}/${code}.json: ${error.message}`);
      continue;
    }
    const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    for (const [base, enForms] of enPlurals) {
      const mine = otherPlurals.get(base) ?? new Map();
      const want = placeholders(enForms.get('other') ?? [...enForms.values()][0]);
      for (const form of forms) {
        if (!mine.has(form)) problems.push(`${dir}/${code}.json: missing ${base}_${form}`);
        else if (placeholders(mine.get(form)) !== want) problems.push(`${dir}/${code}.json: ${base}_${form} has {{${placeholders(mine.get(form))}}}, English {{${want}}}`);
      }
      for (const form of mine.keys()) if (!forms.includes(form)) problems.push(`${dir}/${code}.json: ${base}_${form} is not a plural form of ${code}`);
    }
    for (const base of otherPlurals.keys()) if (!enPlurals.has(base)) problems.push(`${dir}/${code}.json: ${base}_* is not in English`);
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

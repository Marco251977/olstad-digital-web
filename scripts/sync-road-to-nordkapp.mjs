// Road to Nordkapp's own words for the menus and buttons its pages name (Settings, About the game, User ID, Restore
// purchase …) – ONE source: the game's i18n/<lang>.po (the game does not use app-core). Copied here as
// data/road-to-nordkapp-labels.json, so the pages say exactly what the game shows; never typed in on the website.
//   node scripts/sync-road-to-nordkapp.mjs          write the file from the game's repo
//   node scripts/sync-road-to-nordkapp.mjs --check  stop (exit 1) when the copy differs from the game; when the game's
//                                                   repo is not on this machine (e.g. Vercel), say so and pass
// The .po files are read with `git show <ref>:i18n/<lang>.po` – the game's checkout is never touched. Ref:
// ROAD_TO_NORDKAPP_REF, else main. Repo: ROAD_TO_NORDKAPP_REPO, else ~/Utvikling/road-to-nordkapp.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_LANGUAGES } from 'app-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET = 'data/road-to-nordkapp-labels.json';
const repo = process.env.ROAD_TO_NORDKAPP_REPO ?? path.join(os.homedir(), 'Utvikling/road-to-nordkapp');
const ref = process.env.ROAD_TO_NORDKAPP_REF ?? 'main';
// The placeholder on the website ({{settings}}) → the game's key (tr("SETTINGS")).
const KEYS = {
  settings: 'SETTINGS',
  about: 'ABOUT',
  userId: 'USER_ID',
  journey: 'GROUP_JOURNEY',
  restore: 'PURCHASE_RESTORE',
  route: 'MENU_ROUTE',
  fullRoadtrip: 'PURCHASE_TITLE',
  purchaseDesc: 'PURCHASE_DESC',
};

/** msgid → msgstr (strings on several lines joined, escapes read). */
function parsePo(text) {
  const out = {};
  const unquote = (line) => JSON.parse(line.trim());
  let id = null;
  let field = null;
  let value = '';
  const flush = () => {
    if (field === 'msgstr' && id) out[id] = value;
  };
  for (const line of text.split('\n')) {
    const m = line.match(/^(msgid|msgstr)\s+(".*")\s*$/);
    if (m) {
      if (m[1] === 'msgid') {
        flush();
        id = null;
      } else id = value;
      field = m[1];
      value = unquote(m[2]);
    } else if (/^\s*".*"\s*$/.test(line) && field) value += unquote(line);
    else {
      flush();
      field = null;
      id = null;
      value = '';
    }
  }
  flush();
  return out;
}

function build() {
  if (!fs.existsSync(path.join(repo, '.git'))) return null;
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', '--short', ref], { encoding: 'utf8' }).trim();
  const labels = {};
  for (const { code } of CORE_LANGUAGES) {
    const po = parsePo(execFileSync('git', ['-C', repo, 'show', `${ref}:i18n/${code}.po`], { encoding: 'utf8' }));
    labels[code] = Object.fromEntries(
      Object.entries(KEYS).map(([name, key]) => {
        if (!po[key]) throw new Error(`Road to Nordkapp ${code}.po: no ${key}`);
        return [name, po[key]];
      }),
    );
  }
  return { sha, text: JSON.stringify({ generatedBy: 'olstad-digital-web scripts/sync-road-to-nordkapp.mjs from road-to-nordkapp i18n/*.po', labels }, null, 2) + '\n' };
}

const found = build();
const target = path.join(root, TARGET);
if (found === null) {
  console.log(`Road to Nordkapp labels: the game's repo is not here (${repo}) – copy not checked.`);
  process.exit(0);
}
if (process.argv.includes('--check')) {
  const copy = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
  if (copy !== found.text) {
    console.error(`Road to Nordkapp labels: ${TARGET} differs from the game's ${ref} (${found.sha}) – run node scripts/sync-road-to-nordkapp.mjs`);
    process.exit(1);
  }
  console.log(`Road to Nordkapp labels OK (same as ${ref} ${found.sha}).`);
} else {
  fs.writeFileSync(target, found.text);
  console.log(`Wrote ${TARGET} from road-to-nordkapp ${ref} (${found.sha}).`);
}

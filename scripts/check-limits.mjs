// The Free and Pro limits on the support page come from the app: Saldo Pocket's src/shared/entitlements.ts
// (FREE_LIMITS, PRO_LIMITS, and LIMIT_UNITS: how each limit counts – `kept`, `perMonth` or `total`) is the one source.
// data/apps.json (`limits.free`, `limits.pro`, `limits.units`) holds a copy, because the pages are built here and
// Vercel only serves them. This script compares the copy with the app and stops (exit 1) when a number or a unit
// differs, the app has a limit the site lacks, or the site has a limit that is not a whole number (never «unlimited»
// or «included» in place of a number).
//   node scripts/check-limits.mjs          compare
//   node scripts/check-limits.mjs --write  copy the app's numbers into data/apps.json (then npm run build:pages)
//   node scripts/check-limits.mjs --strict also stop when the app repo is not found, or the site has a limit the app lacks
// The app repo: SALDO_POCKET_DIR, else the sibling folder ../Apper/Saldo Pocket. Without it (another machine, CI) the
// check is skipped with a message, unless --strict.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = process.env.SALDO_POCKET_DIR ?? path.resolve(root, '../Apper/Saldo Pocket');
const source = path.join(appDir, 'src/shared/entitlements.ts');
const strict = process.argv.includes('--strict');
const write = process.argv.includes('--write');

if (!fs.existsSync(source)) {
  console[strict ? 'error' : 'log'](`Limits: ${source} not found${strict ? '' : ', check skipped'} (set SALDO_POCKET_DIR).`);
  process.exit(strict ? 1 : 0);
}

/** `export const NAME … = { key: 4, … }` → { key: 4 } (numbers), or { key: 'total' } with `units`. */
function readTable(text, name, units = false) {
  const match = text.match(new RegExp(`export const ${name}\\b[^=]*=\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`entitlements.ts: ${name} not found`);
  const table = {};
  for (const line of match[1].split(/[,\n]/)) {
    const entry = line.replace(/\/\/.*$/, '').trim();
    if (!entry) continue;
    if (units) {
      const m = entry.match(/^(\w+)\s*:\s*'(kept|perMonth|total)'$/);
      if (!m) throw new Error(`entitlements.ts: ${name} has «${entry}», not 'kept', 'perMonth' or 'total'`);
      table[m[1]] = m[2];
      continue;
    }
    const m = entry.match(/^(\w+)\s*:\s*(\d+)$/);
    if (!m) throw new Error(`entitlements.ts: ${name} has «${entry}», not a whole number`);
    table[m[1]] = Number(m[2]);
  }
  return table;
}

const text = fs.readFileSync(source, 'utf8');
const app = { free: readTable(text, 'FREE_LIMITS'), pro: readTable(text, 'PRO_LIMITS'), units: readTable(text, 'LIMIT_UNITS', true) };
const appsFile = path.join(root, 'data/apps.json');
const raw = fs.readFileSync(appsFile, 'utf8');
const data = JSON.parse(raw);
const site = data.apps.find((a) => a.slug === 'saldo-pocket');
const problems = [];
const notes = [];

site.limits.units ??= {};
for (const key of Object.keys(app.free)) if (!(key in app.units)) problems.push(`entitlements.ts: ${key} has no unit in LIMIT_UNITS`);
for (const plan of ['free', 'pro', 'units']) {
  for (const [key, value] of Object.entries(app[plan])) {
    if (site.limits[plan][key] === value) continue;
    if (write) site.limits[plan][key] = value;
    else problems.push(`${plan}.${key}: the app has ${value}, data/apps.json ${site.limits[plan][key] ?? 'nothing'}`);
  }
  for (const [key, value] of Object.entries(site.limits[plan])) {
    if (plan !== 'units' && !Number.isInteger(value)) problems.push(`${plan}.${key} = ${JSON.stringify(value)} in data/apps.json: a limit is a whole number`);
    if (!(key in app[plan])) notes.push(`${plan}.${key} = ${JSON.stringify(site.limits[plan][key])} is only on the site (not in the app's ${{ free: 'FREE_LIMITS', pro: 'PRO_LIMITS', units: 'LIMIT_UNITS' }[plan]}): checked by hand`);
  }
}

if (write) {
  const out = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(appsFile, raw.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out);
  console.log('Limits copied from the app into data/apps.json. Run npm run build:pages.');
}
for (const note of notes) console.log(`Limits: ${note}`);
if (problems.length || (strict && notes.length)) {
  console.error(`Limits differ from ${source}:\n${[...problems, ...(strict ? notes : [])].join('\n')}\nRun npm run sync:limits, then npm run build:pages.`);
  process.exit(1);
}
if (!write) console.log(`Limits OK: data/apps.json matches the app (${Object.keys(app.free).length} limits).`);

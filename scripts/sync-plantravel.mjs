// PlanTravel's display names for its usage events – ONE source: PlanTravel's shared/generated/usage-event-names.json
// (generated there from shared/usage-texts.ts). Copied here unchanged as data/plantravel-event-names.json, the way the
// Saldo app writes its texts to this site; never typed in on the website.
//   node scripts/sync-plantravel.mjs          copy the file from the PlanTravel repo
//   node scripts/sync-plantravel.mjs --check  stop (exit 1) when the copy differs from the source; when the PlanTravel
//                                             repo is not on this machine (e.g. Vercel), say so and pass
// The file is read with `git show <ref>:<path>` – the PlanTravel repo's checkout is never touched. Ref: PLANTRAVEL_REF,
// else master, else the round-2 branch until it is merged. Repo: PLANTRAVEL_REPO, else ../Apper/PlanTravel/TravelPlanner.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'shared/generated/usage-event-names.json';
export const TARGET = 'data/plantravel-event-names.json';
const repo = process.env.PLANTRAVEL_REPO ?? path.resolve(root, '../Apper/PlanTravel/TravelPlanner');
const refs = process.env.PLANTRAVEL_REF ? [process.env.PLANTRAVEL_REF] : ['master', 'feat/usage-r2-server'];
const lf = (s) => s.replace(/\r\n/g, '\n');

function source() {
  if (!fs.existsSync(path.join(repo, '.git'))) return null;
  for (const ref of refs) {
    try {
      const text = execFileSync('git', ['-C', repo, 'show', `${ref}:${SOURCE}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return { ref, text: lf(text) };
    } catch {}
  }
  return undefined;
}

const found = source();
const check = process.argv.includes('--check');
if (found === null) {
  console.log(`PlanTravel event names: the PlanTravel repo is not here (${repo}) – copy not checked.`);
  process.exit(0);
}
if (found === undefined) {
  console.error(`PlanTravel event names: ${SOURCE} is in none of ${refs.join(', ')} in ${repo}.`);
  process.exit(1);
}
JSON.parse(found.text); // must be JSON
const target = path.join(root, TARGET);
if (check) {
  const copy = fs.existsSync(target) ? lf(fs.readFileSync(target, 'utf8')) : null;
  if (copy !== found.text) {
    console.error(`PlanTravel event names: ${TARGET} differs from PlanTravel ${found.ref}:${SOURCE} – run node scripts/sync-plantravel.mjs`);
    process.exit(1);
  }
  console.log(`PlanTravel event names OK (same as ${found.ref}).`);
} else {
  fs.writeFileSync(target, found.text);
  console.log(`Wrote ${TARGET} from PlanTravel ${found.ref}:${SOURCE}.`);
}

// Saldo Pocket 1.0.10: the button «Slå på automatisk registrering» opens
// https://www.nordicdigitalapp.com/snarvei/saldo-pocket, which forwards to the shared iCloud shortcut.
// The link lives ONLY in vercel.json («redirects»). To change the shortcut later, change «destination» there –
// no new app build needed. Must stay temporary (307, «permanent»: false) so browsers and the app don't cache it,
// and must stay outside the language middleware's matcher (middleware.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('/snarvei/saldo-pocket is a temporary redirect to an iCloud shortcut', () => {
  const r = vercel.redirects?.find((x) => x.source === '/snarvei/saldo-pocket');
  assert.ok(r, 'redirect missing in vercel.json');
  assert.equal(r.permanent, false);
  assert.match(r.destination, /^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}$/);
});

test('the language middleware does not catch /snarvei', () => {
  const src = readFileSync(new URL('../middleware.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /snarvei/);
});

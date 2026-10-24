// Prompt 153 (Marco 24.10): the apps' pages take menu paths and period names from the app's own keys
// (data/privacy-facts.json labels, written by Saldo Pocket's `node scripts/privacy.mjs --sync`), never written out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const facts = JSON.parse(read('data/privacy-facts.json'));
const strings = (o) => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(strings) : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : []);

for (const [app, f] of Object.entries(facts.apps)) {
  test(`${app}: menu paths and period names come from the app's keys, never written out`, () => {
    for (const [lang, labels] of Object.entries(f.labels ?? {})) {
      for (const text of strings(JSON.parse(read(`i18n/apps/${app}/${lang}.json`)))) {
        // A menu path is an arrow between two placeholders ({{menuMe}} → {{menuExport}}), never a name beside an arrow.
        for (const m of text.matchAll(/(.{0,16})[→←](.{0,16})/gu)) {
          assert.match(`${m[1]}→${m[2]}`, /\}\}\W{0,3}→\W{0,3}\{\{/u, `${app} ${lang}: written-out menu path «${m[0]}»`);
        }
        for (const [key, value] of Object.entries(labels)) {
          // Menu names are ordinary words too («Me», «Your data», zh 我, «meine Daten exportieren»): written out as a name
          // means in quotes (or beside an arrow, above). Period names are never in the text at all.
          const asName = !key.startsWith('period');
          const found = asName ? ['«', '“', '„', '「', '"', '‘'].some((q) => text.includes(`${q}${value}`)) : text.includes(value);
          assert.ok(!found, `${app} ${lang}: «${value}» (${key}) written out – use {{${key}}}`);
        }
      }
    }
  });
}

test('the labels have the menu path and the period names for every language', () => {
  for (const [lang, labels] of Object.entries(facts.apps['saldo-pocket'].labels)) {
    for (const key of ['menuMe', 'menuData', 'menuExport', 'menuDelete', 'menuDeleteConfirm', 'periodPay', 'periodCalendar']) assert.ok(labels[key], `${lang} ${key}`);
  }
});

test('hi: one spelling of आंकड़े and the app’s word for pay (सैलरी)', () => {
  const hi = read('i18n/apps/saldo-pocket/hi.json');
  assert.doesNotMatch(hi, /आँकड़|वेतन/u);
});

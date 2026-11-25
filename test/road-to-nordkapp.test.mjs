// Road to Nordkapp (Marco 25.11): a privacy policy and a support page on every language, at the same addresses as the
// other apps (/<lang>/road-to-nordkapp/privacy and /support), neutral about the stores (the pages are linked from both),
// with the game's own menu names (data/road-to-nordkapp-labels.json) and Marco's details marked until he fills them in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { CORE_LANGUAGES } from 'app-core';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const app = JSON.parse(read('data/apps.json')).apps.find((a) => a.slug === 'road-to-nordkapp');
const labels = JSON.parse(read('data/road-to-nordkapp-labels.json')).labels;
const strings = (o) => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(strings) : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : []);

test('a privacy policy and a support page per language, in the right direction, with the date', () => {
  assert.deepEqual(app.pages, ['privacy', 'support']);
  for (const l of CORE_LANGUAGES) {
    for (const page of app.pages) {
      const html = read(`${l.code}/road-to-nordkapp/${page}.html`);
      assert.match(html, new RegExp(`<html lang="${l.code}" dir="${l.rtl ? 'rtl' : 'ltr'}">`), `${l.code} ${page}`);
      assert.match(html, /<p class="updated">/, `${l.code} ${page}: last updated`);
    }
  }
  for (const page of app.pages) assert.ok(fs.existsSync(new URL(`../road-to-nordkapp/${page}.html`, import.meta.url)), `/road-to-nordkapp/${page}`);
  assert.match(read('middleware.js'), /"\/road-to-nordkapp\/privacy","\/road-to-nordkapp\/support"/);
});

test('menu paths point the way the language reads (→, right to left ←)', () => {
  for (const l of CORE_LANGUAGES) {
    const text = read(`i18n/apps/road-to-nordkapp/${l.code}.json`);
    assert.doesNotMatch(text, l.rtl ? /→/u : /←/u, l.code);
  }
});

test('no store or platform named on any language (the pages are linked from both stores)', () => {
  for (const l of CORE_LANGUAGES) {
    const text = read(`i18n/apps/road-to-nordkapp/${l.code}.json`);
    assert.doesNotMatch(text, /Apple|Google|App Store|Play|iPhone|iPad|iOS|Android/u, l.code);
  }
});

test('Marco’s details are marked placeholders, never guessed or linked', () => {
  for (const key of ['orgNumber', 'address', 'email']) assert.match(app.publisher[key], /^\[[^\]]+\]$/);
  for (const l of CORE_LANGUAGES) {
    const privacy = read(`${l.code}/road-to-nordkapp/privacy.html`);
    const support = read(`${l.code}/road-to-nordkapp/support.html`);
    for (const p of ['[ORGANISASJONSNUMMER]', '[ADRESSE]', '[KONTAKT-E-POST]']) assert.ok(privacy.includes(`<span class="placeholder">${p}</span>`), `${l.code} privacy ${p}`);
    assert.ok(support.includes('<span class="placeholder">[KONTAKT-E-POST]</span>'), `${l.code} support e-mail`);
    assert.doesNotMatch(privacy + support, /mailto:\[/, l.code);
  }
});

test('the game’s menu names come from the game, never written out', () => {
  for (const l of CORE_LANGUAGES) {
    // Each text on its own (the JSON's own quote marks would look like a quoted name).
    const text = strings(JSON.parse(read(`i18n/apps/road-to-nordkapp/${l.code}.json`))).join('\n');
    for (const m of text.matchAll(/(.{0,16})[→←](.{0,16})/gu)) assert.match(`${m[1]}→${m[2]}`, /\}\}\W{0,3}→\W{0,3}\{\{/u, `${l.code}: written-out menu path «${m[0]}»`);
    for (const key of ['settings', 'about', 'copyUserId', 'restore']) {
      const found = ['«', '“', '„', '「', '"', '‘'].some((q) => text.includes(`${q}${labels[l.code][key]}`));
      assert.ok(!found, `${l.code}: «${labels[l.code][key]}» written out – use {{${key}}}`);
    }
    const support = read(`${l.code}/road-to-nordkapp/support.html`);
    for (const key of ['settings', 'about', 'restore']) assert.ok(support.includes(labels[l.code][key]), `${l.code} support: ${key}`);
  }
});

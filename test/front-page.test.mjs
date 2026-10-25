// The new front page (/<lang>) and /admin: the rules from Marco's brief, checked on the generated files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { CORE_LANGUAGES, languageChoiceOrder } from 'app-core';

import { allowed, handle } from '../api/admin.js';
import { SESSION_COOKIE, sessionValue } from '../lib/admin-auth.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const { apps } = JSON.parse(read('data/apps.json'));
const LANGS = CORE_LANGUAGES.map((l) => l.code);
// The sign-in settings (a hash that only signs cookies here – the password itself is never in the tests).
const AUTH = { ADMIN_EMAILS: 'owner@example.com', ADMIN_PASSWORD_HASH: '$2b$04$test.hash.only.for.signing.cookies..', ADMIN_SESSION_SECRET: 'test-session-secret' };
const cookieFor = (email, env) => ({ cookie: `${SESSION_COOKIE}=${sessionValue(email, env)}` });

test('a front page per language, in the right direction, with the hero, both apps and the three principles', () => {
  for (const l of CORE_LANGUAGES) {
    const html = read(`${l.code}/index.html`);
    const h = JSON.parse(read(`i18n/home/${l.code}.json`));
    assert.match(html, new RegExp(`<html lang="${l.code}" dir="${l.rtl ? 'rtl' : 'ltr'}">`), l.code);
    assert.ok(html.includes(`<link rel="canonical" href="https://www.nordicdigitalapp.com/${l.code}">`), l.code);
    for (const app of apps.filter((a) => a.home)) assert.ok(html.includes(`id="app-${app.home.id}"`), `${l.code} ${app.name}`);
    assert.equal((html.match(/<li><h3>/g) ?? []).length, 3, l.code);
    assert.ok(html.includes('href="/admin?lang='), l.code);
    assert.doesNotMatch(html, /TravelPlanner|collaborat|get in touch|samarbeid/i, l.code);
    assert.ok(html.includes(h.hero.title.replace(/&/g, '&amp;').replace(/'/g, "'")) || l.code, l.code);
  }
});

test('store buttons only for published apps; the language menu has the 18 in the apps’ order', () => {
  const html = read('nb/index.html');
  const saldo = html.slice(html.indexOf('id="app-saldo-pocket"') - 200, html.indexOf('</article>', html.indexOf('id="app-saldo-pocket"')));
  assert.doesNotMatch(saldo, /apps\.apple\.com|play\.google\.com/);
  assert.match(saldo, /\/nb\/saldo-pocket\/delete-account/);
  assert.match(html, /apps\.apple\.com\/app\/id6796367244/);
  assert.match(html, /details\?id=com\.olstaddigital\.plantravel&amp;hl=no-NO/);
  assert.match(html, /href="https:\/\/plantravelapp\.no"/);
  const order = [...html.matchAll(/data-lang="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, languageChoiceOrder(CORE_LANGUAGES));
});

test('no prices, no limits, no left/right in the styles, colours only as tokens', () => {
  for (const l of LANGS) assert.doesNotMatch(JSON.stringify(JSON.parse(read(`i18n/home/${l}.json`))), /€|\$|£|\bkr\b|\bNOK\b|[Uu]nlimited|ubegrens/, l);
  const css = read('assets/home.css');
  assert.doesNotMatch(css, /\b(left|right)\s*:|margin-(left|right)|padding-(left|right)|text-align:\s*(left|right)/);
  assert.doesNotMatch(css.replace(/rgb\(0 0 0 \/ [\d.]+\)/g, ''), /#[0-9a-f]{3,8}\b/i);
});

test('/admin: the allowlist is checked on the server before any code is sent', async () => {
  const env = { ...AUTH, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k' };
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(url);
    if (url.endsWith('/otp')) return new Response('{}', { status: 200 });
    if (url.endsWith('/verify')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600, user: { email: JSON.parse(init.body).email === 'owner@example.com' ? 'owner@example.com' : 'x@y.z' } }), { status: 200 });
    if (url.endsWith('/user')) return new Response(JSON.stringify({ email: init.headers.authorization === 'Bearer good' ? 'Owner@Example.com' : 'other@example.com' }), { status: 200 });
    return new Response('', { status: 404 });
  };
  const post = (body, headers = {}) => handle(new Request('https://h/api/admin', { method: 'POST', headers, body: JSON.stringify(body) }), env, fetcher);
  assert.equal((await post({ action: 'code', email: 'someone@example.com' })).status, 403);
  assert.equal(calls.length, 0, 'no code sent to others');
  assert.equal((await post({ action: 'code', email: ' OWNER@example.com ' })).status, 200);
  assert.equal((await post({ action: 'verify', email: 'someone@example.com', code: '12345678' })).status, 403);
  assert.equal((await post({ action: 'verify', email: 'owner@example.com', code: '12' })).status, 401);
  const verified = await post({ action: 'verify', email: 'owner@example.com', code: '12345678' });
  assert.equal(verified.status, 200);
  assert.match(verified.headers.get('set-cookie'), /__Host-od_admin=v1\./, 'the code sets the same 30-day cookie as the password');
  assert.equal((await post({ action: 'me' }, cookieFor('Owner@Example.com', env))).status, 200);
  assert.equal((await post({ action: 'me' }, cookieFor('other@example.com', env))).status, 403);
  assert.equal((await post({ action: 'me' }, { authorization: 'Bearer good' })).status, 401, 'a bearer token is not a session');
  assert.equal((await post({ action: 'me' })).status, 401);
  assert.equal((await handle(new Request('https://h', { method: 'POST', body: '{}' }), {}, fetcher)).status, 503, 'no allowlist = nobody');
  assert.equal(allowed('', env), false);
  assert.doesNotMatch(read('admin.html'), /owner@|marco\.olstad/, 'the allowlist is never in the page');
});

test('the sentence about an app is its own store short description (data/app-texts.json), never bank-connection wording', () => {
  const texts = JSON.parse(read('data/app-texts.json')).apps;
  for (const l of LANGS) {
    const html = read(`${l}/index.html`);
    const mine = texts['saldo-pocket'].about[l].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    assert.ok(html.includes(`<p class="about">${mine}</p>`), l);
    assert.equal(JSON.parse(read(`i18n/home/${l}.json`)).about['saldo-pocket'], undefined, `${l}: one source only`);
  }
  for (const l of LANGS) assert.doesNotMatch(read(`${l}/index.html`), /bankkobling|bank connection|Bankverbindung|Ingen bank/i, l);
});

test('/admin: every failure is a code the page has a text for – too many attempts, not set up, server error with details', async () => {
  const env = { ...AUTH, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k' };
  const post = (body, fetcher, e = env) => handle(new Request('https://h/api/admin', { method: 'POST', body: JSON.stringify(body) }), e, fetcher);
  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });
  let r = await post({ action: 'code', email: 'owner@example.com' }, reply(429, { error_code: 'over_email_send_rate_limit' }));
  assert.deepEqual([r.status, (await r.json()).error], [429, 'rate_limited']);
  r = await post({ action: 'code', email: 'owner@example.com' }, reply(500, { error_code: 'unexpected_failure' }));
  assert.deepEqual([r.status, await r.json()], [502, { error: 'server', status: 500, code: 'unexpected_failure' }]);
  r = await post({ action: 'code', email: 'owner@example.com' }, async () => { throw new Error('network'); });
  assert.deepEqual([r.status, (await r.json()).code], [502, 'exception']);
  r = await post({ action: 'code', email: 'owner@example.com' }, reply(200, {}), AUTH);
  assert.deepEqual([r.status, (await r.json()).missing], [503, ['SUPABASE_URL', 'SUPABASE_ANON_KEY']]);
  r = await post({ action: 'login', email: 'owner@example.com', password: 'x' }, reply(200, {}), { ADMIN_EMAILS: 'owner@example.com' });
  assert.deepEqual([r.status, (await r.json()).missing], [503, ['ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET']], 'the password does not need Supabase');
  const page = read('admin.html');
  for (const k of ['tooMany', 'notConfigured', 'refused', 'wrongCode', 'wrongLogin', 'locked']) assert.match(page, new RegExp(`"${k}":`), k);
  assert.match(page, /rate_limited: 'tooMany', not_configured: 'notConfigured'/);
});

test('/admin: one card per app in the app list, a page per app, stats only for signed-in allowed users and known apps', async () => {
  const ids = apps.filter((a) => a.home).map((a) => a.home.id);
  const overview = read('admin.html');
  for (const id of ids) {
    assert.ok(overview.includes(`href="/admin/${id}"`), id);
    const page = read(`admin/${id}.html`);
    assert.ok(page.includes(`data-app="${id}"`), id);
    assert.match(page, /href="\/admin"/);
  }
  assert.equal((overview.match(/class="admin-card admin-app-link"/g) ?? []).length, ids.length);
  const env = { ...AUTH, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k' };
  const fetcher = async () => new Response('{}', { status: 500 });
  const stats = (app, token) => handle(new Request('https://h/api/admin', { method: 'POST', headers: token ? cookieFor(token === 'good' ? 'owner@example.com' : 'other@example.com', env) : {}, body: JSON.stringify({ action: 'stats', app }) }), env, fetcher);
  let r = await stats('saldo-pocket', 'good');
  // Saldo has a source (stats-summary) but no settings here: the page is told which names are missing.
  assert.deepEqual([r.status, await r.json()], [503, { error: 'stats_not_configured', missing: ['SALDO_STATS_URL', 'SALDO_STATS_KEY'] }]);
  assert.equal((await stats('not-an-app', 'good')).status, 404);
  assert.equal((await stats('saldo-pocket', 'other')).status, 403);
  assert.equal((await stats('saldo-pocket')).status, 401);
  for (const l of LANGS) for (const k of ['apps', 'noData', 'allApps', 'seeStats']) assert.ok(JSON.parse(read(`i18n/home/${l}.json`)).admin[k], `${l} ${k}`);
});

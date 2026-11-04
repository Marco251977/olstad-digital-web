// /admin/saldo-pocket «Abonnementsvarsel» (04.11): the proof log of the half-yearly subscription notice, read only, fetched
// on the server (lib/notices.js) with Saldo's key, which never reaches the browser. The function may not exist yet: then
// the section says so (notices_missing), never a crash.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { CORE_LANGUAGES } from 'app-core';

import { handle } from '../api/admin.js';
import { errorText, MISSING, noticeRows, noticesMonths } from '../assets/admin-notices.js';
import { SESSION_COOKIE, sessionValue } from '../lib/admin-auth.js';
import { fetchNotices, noticeRow } from '../lib/notices.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const KEY = 'saldo-secret-key-123456';
const ENV = {
  ADMIN_EMAILS: 'owner@example.com',
  ADMIN_PASSWORD_HASH: '$2b$04$test.hash.only.for.signing.cookies..',
  ADMIN_SESSION_SECRET: 'test-session-secret',
  SALDO_STATS_URL: 'https://p.supabase.co/functions/v1/stats-summary',
  SALDO_STATS_KEY: KEY,
};
const ROW = {
  due_on: '2026-11-04', notice_kind: 'running_6m', channel: 'in_app', shown_at_utc: '2026-11-04T09:00:12.000Z', shown_tz: 'Europe/Oslo',
  dismissed_at: '2026-11-04T09:01:00Z', manage_tapped_at: null, email_sent_at: null, resend_id: null, plan: 'annual', store: 'app_store',
  product: 'saldopocket_pro_yearly', price_minor: 39900, currency: 'NOK', price_missing: false, text_version: '1', text_hash: 'ab12cd',
  test_traffic: false, retain_until: '2030-11-04', created_at: '2026-11-04T09:00:13Z',
};
const textsFor = (lang) => JSON.parse(JSON.stringify(JSON.parse(read(`i18n/home/${lang}.json`)).admin).replace(/\{\{(\w+)\}\}/g, '%$1%'));
const session = (env = ENV) => ({ cookie: `${SESSION_COOKIE}=${sessionValue('owner@example.com', env)}` });

function fakeFetch(reply) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return reply(String(url), init);
  };
  return { calls, fetcher };
}

test('lib/notices: the function next to stats-summary, with the key, and only known fields come back', async () => {
  const { calls, fetcher } = fakeFetch(() => new Response(JSON.stringify({ ok: true, rows: [{ ...ROW, email: 'x@y.z', user_id: 'u1', name: 'Kari', rc_customer_hash: 'h' }] }), { status: 200 }));
  const r = await fetchNotices('saldo', { view: 'purchase', purchase: 'GPA.1234-5678-9012-34567' }, ENV, fetcher);
  assert.equal(r.status, 200);
  assert.equal(calls[0].url, 'https://p.supabase.co/functions/v1/subscription-notice-admin?purchase=GPA.1234-5678-9012-34567&test=0');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(Object.keys(r.body.rows[0]).sort(), Object.keys(ROW).sort());
  assert.doesNotMatch(JSON.stringify(r.body), /x@y\.z|Kari|u1|rc_customer_hash/);
  const months = await fetchNotices('saldo', { view: 'months', includeTest: true }, ENV, fakeFetch(() => new Response(JSON.stringify({ ok: true, months: [{ month: '2026-11', channel: 'email', sent: 3, shown: null, dismissed: 'x' }] }))).fetcher);
  assert.deepEqual(months.body.months, [{ month: '2026-11', channel: 'email', sent: 3, shown: null, dismissed: null }]);
});

test('lib/notices: a bad value is null, never passed on', () => {
  const r = noticeRow({ ...ROW, shown_tz: '<script>', price_minor: '399', currency: 'nok', resend_id: 'a b@c' });
  assert.equal(r.shown_tz, null);
  assert.equal(r.price_minor, null);
  assert.equal(r.currency, null);
  assert.equal(r.resend_id, null);
});

test('lib/notices: the function not deployed (404) = notices_missing; refused, server, timeout, bad ID, not set up', async () => {
  const at = (status, body = '{}') => fetchNotices('saldo', { view: 'months' }, ENV, fakeFetch(() => new Response(body, { status })).fetcher);
  assert.deepEqual(await at(404), { status: 503, body: { error: 'notices_missing' } });
  assert.equal((await at(401)).body.error, 'source_refused');
  assert.deepEqual(await at(500, JSON.stringify({ ok: false, error: 'server' })), { status: 502, body: { error: 'source', code: 'server' } });
  assert.equal((await at(200, 'not json')).body.code, 'bad_json');
  const down = await fetchNotices('saldo', { view: 'months' }, ENV, async () => { throw new TypeError('fetch failed'); });
  assert.equal(down.status, 504);
  const { calls, fetcher } = fakeFetch(() => new Response('{}'));
  assert.equal((await fetchNotices('saldo', { purchase: 'a b<c>' }, ENV, fetcher)).status, 400);
  assert.equal(calls.length, 0, 'a bad ID is never sent');
  const missing = await fetchNotices('saldo', { view: 'months' }, { ...ENV, SALDO_STATS_KEY: '' }, fetcher);
  assert.deepEqual(missing.body, { error: 'notices_not_configured', missing: ['SALDO_STATS_KEY'] });
});

test('/api/admin notices: only with the session cookie; an app without a source has no log', async () => {
  const { calls, fetcher } = fakeFetch(() => new Response(JSON.stringify({ ok: true, months: [] })));
  const post = (body, headers = {}) => handle(new Request('https://h/api/admin', { method: 'POST', headers, body: JSON.stringify(body) }), ENV, fetcher);
  assert.equal((await post({ action: 'notices', app: 'saldo-pocket', view: 'months' })).status, 401);
  assert.equal(calls.length, 0);
  const ok = await post({ action: 'notices', app: 'saldo-pocket', view: 'months' }, session());
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).data, { months: [] });
  const none = await post({ action: 'notices', app: 'plantravel', view: 'months' }, session());
  assert.deepEqual((await none.json()).data, null);
});

test('the view: months per channel, rows with every field, price in its currency or «missing»', () => {
  const t = textsFor('nb');
  const m = noticesMonths([{ month: '2026-10', channel: 'in_app', sent: 2, shown: 2, dismissed: 1 }, { month: '2026-11', channel: 'email', sent: 1, shown: null, dismissed: null }], t, 'nb');
  assert.equal(m.rows[0].cells[0], t.notices.channels.email, 'newest month first');
  assert.equal(m.rows[0].cells[2], MISSING, 'missing = –, never 0');
  const [row] = noticeRows([ROW], t, 'nb');
  const value = (label) => row.lines.find((l) => l.label === label).value;
  assert.match(value(t.notices.price), /399/);
  assert.match(value(t.notices.shown), /Europe\/Oslo/);
  assert.equal(value(t.notices.store), 'App Store');
  assert.equal(value(t.notices.manage), t.notices.no);
  const [noPrice] = noticeRows([{ ...ROW, price_missing: true, price_minor: null }], t, 'nb');
  assert.equal(noPrice.lines.find((l) => l.label === t.notices.price).value, t.notices.priceMissing);
  assert.equal(errorText({ error: 'notices_missing' }, t), t.notices.missing);
});

test('every language has the texts; the browser script never sees a key or a URL, and writes text only', () => {
  const en = textsFor('en').notices;
  for (const { code } of CORE_LANGUAGES) {
    const n = textsFor(code).notices;
    for (const k of Object.keys(en)) assert.ok(n[k], `${code} ${k}`);
  }
  const files = ['admin/saldo-pocket.html', 'assets/admin-notices.js'];
  for (const f of files) assert.doesNotMatch(read(f), /SALDO_|STATS_KEY|subscription-notice-admin|stats-summary/, f);
  assert.doesNotMatch(read('assets/admin-notices.js'), /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(read('admin/saldo-pocket.html'), /id="notices"/);
  assert.doesNotMatch(read('admin/plantravel.html'), /id="notices"/);
});

// /admin/plantravel (Marco 24.10): the numbers come from PlanTravel's GET /stats/summary, fetched on the website's server
// side with a key that never reaches the browser; only signed-in addresses on the allowlist get them; missing numbers are «–».
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { CORE_LANGUAGES } from 'app-core';

import { handle } from '../api/admin.js';
import { MISSING, renderStats, statsView } from '../assets/admin-stats.js';
import { summary } from '../lib/stats.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const NAMES = JSON.parse(read('data/plantravel-event-names.json')).names;
const SECRET = 'pt-secret-key-123456';
const ENV = { ADMIN_EMAILS: 'owner@example.com', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', PLANTRAVEL_API_URL: 'https://api.plantravel.example/', PLANTRAVEL_STATS_KEY: SECRET };
const SAMPLE = {
  period: { from: '2026-09-24', to: '2026-10-23', days: 30 },
  active: { day: 120, week: 640, month: 2100 },
  retention: { day1: 0.42, day7: 0.21, day30: 0.09 },
  onboarding: { started: 300, done: 240, skipped: 30 },
  events: { 'search_done:flight': 900, app_active: 450, not_named_yet: 7 },
  platforms: { ios: 1200, android: 900 },
  versions: { '2.4.1': 1500, '2.4.0': 600 },
  languages: { nb: 1000, en: 700 },
  providerClicks: { Kiwi: 80, Booking: 40 },
  legacy: { users: 5400, events: { search: 12000 } },
  includesTest: false,
};

/** A fetch that answers Supabase (the token «good» = the allowed owner) and PlanTravel (reply). Records every call. */
function fakeFetch(reply = () => new Response(JSON.stringify(SAMPLE), { status: 200 })) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('https://x.supabase.co/auth/v1/user')) {
      return new Response(JSON.stringify({ email: init.headers.authorization === 'Bearer good' ? 'owner@example.com' : 'other@example.com' }), { status: 200 });
    }
    return reply(url, init);
  };
  return { calls, fetcher, toPlanTravel: () => calls.filter((c) => c.url.startsWith('https://api.plantravel.example')) };
}

const stats = (body, token, env = ENV, fetcher) =>
  handle(new Request('https://h/api/admin', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify({ action: 'stats', app: 'plantravel', ...body }) }), env, fetcher);

test('statistics without sign-in → 401, another address → 403, and PlanTravel is never asked', async () => {
  const f = fakeFetch();
  assert.equal((await stats({}, null, ENV, f.fetcher)).status, 401);
  assert.equal((await stats({}, 'other', ENV, f.fetcher)).status, 403);
  assert.equal(f.toPlanTravel().length, 0);
});

test('signed in: the key goes to PlanTravel as a Bearer header from the server only, never back to the browser', async () => {
  // PlanTravel echoing the key, an e-mail address and free text must not pass: only aggregate numbers are kept.
  const f = fakeFetch(() => new Response(JSON.stringify({ ...SAMPLE, key: SECRET, events: { ...SAMPLE.events, 'someone@example.com': 3, note: 'text' }, users: [{ email: 'a@b.c' }] }), { status: 200 }));
  const r = await stats({}, 'good', ENV, f.fetcher);
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!text.includes(SECRET), 'the key is not in the answer');
  assert.doesNotMatch(text, /@/, 'no e-mail address in the answer');
  const body = JSON.parse(text);
  assert.deepEqual(body.data.events, { 'search_done:flight': 900, app_active: 450, not_named_yet: 7 });
  assert.equal(body.legacyUntil, '2026-10-24');
  const [call] = f.toPlanTravel();
  assert.equal(call.url, 'https://api.plantravel.example/stats/summary?includeTest=0');
  assert.equal(call.init.headers.authorization, `Bearer ${SECRET}`);
});

test('the test-traffic switch is passed on as includeTest=1, default off', async () => {
  const f = fakeFetch();
  await stats({ includeTest: true }, 'good', ENV, f.fetcher);
  await stats({ includeTest: 'yes' }, 'good', ENV, f.fetcher);
  await stats({}, 'good', ENV, f.fetcher);
  assert.deepEqual(f.toPlanTravel().map((c) => new URL(c.url).searchParams.get('includeTest')), ['1', '0', '0']);
  const page = read('admin/plantravel.html');
  assert.match(page, /<input type="checkbox" id="include-test" role="switch">/, 'the switch is off by default');
  assert.match(page, /includeTest: !!\(toggle && toggle\.checked\)/);
  assert.doesNotMatch(read('admin/saldo-pocket.html'), /id="include-test"/, 'only an app with a source has the switch');
});

test('every failure is a code with a text: not connected, refused, server error, no answer, bad JSON', async () => {
  const cases = [
    [{ ...ENV, PLANTRAVEL_STATS_KEY: '' }, () => new Response('{}'), 503, 'stats_not_configured'],
    [ENV, () => new Response('{}', { status: 403 }), 502, 'source_refused'],
    [ENV, () => new Response('{}', { status: 500 }), 502, 'source'],
    [ENV, () => { throw new TypeError('fetch failed'); }, 504, 'source_timeout'],
    [ENV, () => new Response('<html>', { status: 200 }), 502, 'source'],
  ];
  for (const [env, reply, status, error] of cases) {
    const r = await stats({}, 'good', env, fakeFetch(reply).fetcher);
    const body = await r.json();
    assert.deepEqual([r.status, body.error], [status, error], error);
    assert.ok(!JSON.stringify(body).includes(SECRET));
  }
  const missing = await (await stats({}, 'good', { ...ENV, PLANTRAVEL_API_URL: '', PLANTRAVEL_STATS_KEY: '' }, fakeFetch().fetcher)).json();
  assert.deepEqual(missing.missing, ['PLANTRAVEL_API_URL', 'PLANTRAVEL_STATS_KEY'], 'names only');
  const page = read('admin/plantravel.html');
  assert.match(page, /stats_not_configured: 'statsNotConfigured', source_refused: 'sourceRefused', source: 'sourceFailed', source_timeout: 'sourceFailed'/);
  for (const l of CORE_LANGUAGES) {
    const a = JSON.parse(read(`i18n/home/${l.code}.json`)).admin;
    for (const k of ['statsNotConfigured', 'sourceRefused', 'sourceFailed', 'loading', 'retry', 'includeTest']) assert.ok(a[k], `${l.code} ${k}`);
  }
});

test('the key and its name are never in a generated page or the browser script', () => {
  const files = ['admin.html', ...fs.readdirSync(new URL('../admin/', import.meta.url)).map((f) => `admin/${f}`), 'assets/admin-stats.js'];
  for (const f of files) {
    assert.doesNotMatch(read(f), /PLANTRAVEL_|STATS_KEY|api\.plantravel|stats\/summary/, f);
  }
  assert.ok(fs.existsSync(new URL('../.env.example', import.meta.url)));
  const example = read('.env.example');
  for (const name of ['ADMIN_EMAILS', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'PLANTRAVEL_API_URL', 'PLANTRAVEL_STATS_KEY']) assert.match(example, new RegExp(`^${name}=$`, 'm'), `${name} without a value`);
});

const textsFor = (lang) => JSON.parse(JSON.stringify(JSON.parse(read(`i18n/home/${lang}.json`)).admin).replace(/\{\{(\w+)\}\}/g, '%$1%'));

test('missing, null or non-numeric values are «–», never 0', () => {
  const t = textsFor('nb');
  const data = summary({ active: { day: null, week: 'many' }, events: { a: null }, retention: {}, includesTest: true });
  assert.deepEqual(data.active, { day: null, week: null, month: null });
  const view = statsView(data, t, 'nb', null);
  const by = Object.fromEntries(view.map((s) => [s.id, s]));
  assert.deepEqual(by.active.tiles.map((x) => x.value), [MISSING, MISSING, MISSING]);
  for (const id of ['retention', 'onboarding', 'events', 'providerClicks', 'platforms', 'versions', 'languages', 'legacy']) assert.deepEqual(by[id].rows, [{ label: MISSING, value: MISSING }], id);
  assert.equal(by.period.rows[0].value, MISSING);
  assert.equal(by.period.note, t.stats.withTest);
  assert.ok(!JSON.stringify(view).match(/(^|[^\d])0([^\d,.]|$)/), 'no 0 for a missing number');
  // An empty answer (statsView of nothing) too.
  assert.deepEqual(statsView(undefined, t, 'nb').find((s) => s.id === 'active').tiles.map((x) => x.value), [MISSING, MISSING, MISSING]);
});

test('the numbers are laid out in the page language, labels from the texts (id as fallback), legacy apart', () => {
  const t = textsFor('nb');
  const view = statsView(summary(SAMPLE), t, 'nb', '2026-10-24');
  const by = Object.fromEntries(view.map((s) => [s.id, s]));
  assert.deepEqual(by.active.tiles.map((x) => x.value), ['120', '640', new Intl.NumberFormat('nb').format(2100)]);
  assert.deepEqual(by.retention.rows.map((r) => r.label), ['Dag 1', 'Dag 7', 'Dag 30']);
  assert.equal(by.retention.rows[0].value, new Intl.NumberFormat('nb', { style: 'percent', maximumFractionDigits: 1 }).format(0.42));
  assert.deepEqual(by.onboarding.rows.map((r) => r.label), ['Startet', 'Fullført', 'Hoppet over']);
  assert.deepEqual(by.events.rows.map((r) => r.label), ['search_done:flight', 'app_active', 'not_named_yet'], 'without names → the id');
  const named = statsView(summary(SAMPLE), t, 'nb', null, NAMES.nb).find((x) => x.id === 'events');
  assert.deepEqual(named.rows.map((r) => r.label), [NAMES.nb['search_done:flight'], NAMES.nb.app_active, 'not_named_yet'], 'PlanTravel’s names, the id when missing');
  assert.deepEqual(by.platforms.rows.map((r) => r.label), ['iOS', 'Android']);
  assert.equal(by.languages.rows[0].label, new Intl.DisplayNames(['nb'], { type: 'language' }).of('nb'));
  assert.equal(by.legacy.legacy, true);
  assert.match(by.legacy.title, /^Gamle tall \(før .+\)$/);
  assert.equal(by.period.note, t.stats.withoutTest);
  for (const l of CORE_LANGUAGES) {
    const tl = textsFor(l.code);
    const v = statsView(summary(SAMPLE), tl, l.code, '2026-10-24');
    for (const s of v) assert.ok(s.title && !/%\w+%|undefined/.test(JSON.stringify(s)), `${l.code} ${s.id}`);
  }
});

test('the view is written with textContent only – a server value is never read as HTML', () => {
  const made = [];
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this._text = ''; made.push(this); }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text; }
    set innerHTML(v) { throw new Error('innerHTML used'); }
    setAttribute(k, v) { this.attrs[k] = v; }
    appendChild(c) { this.children.push(c); return c; }
  }
  const doc = { createElement: (tag) => new El(tag) };
  const box = new El('div');
  const view = statsView(summary({ events: { '<img src=x onerror=alert(1)>': 1, ok: 2 } }), textsFor('en'), 'en');
  renderStats(box, view, doc);
  assert.ok(made.some((e) => e.textContent === 'ok'));
  // The key regex already drops markup; a label is text either way.
  assert.ok(!made.some((e) => /<img/.test(e.textContent)));
  assert.doesNotMatch(read('assets/admin-stats.js'), /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.doesNotMatch(read('admin/plantravel.html'), /innerHTML|insertAdjacentHTML/);
});

test('PlanTravel’s format (docs/stats-summary.md): onboarding.done, retention null = «–», empty answer = all «–»', () => {
  const t = textsFor('nb');
  const answer = { period: { from: '2026-09-25', to: '2026-10-24', days: 30 }, active: { day: null, week: null, month: null }, retention: { day1: 0.42, day7: null, month1: null }, onboarding: { started: 60, done: 55, skipped: null }, events: null, platforms: null, versions: null, languages: null, providerClicks: null, legacy: null, includesTest: false };
  const by = Object.fromEntries(statsView(summary(answer), t, 'nb', '2026-10-24', NAMES.nb).map((s) => [s.id, s]));
  assert.deepEqual(by.onboarding.rows.map((r) => [r.label, r.value]), [['Startet', '60'], ['Fullført', '55'], ['Hoppet over', MISSING]]);
  assert.deepEqual(by.retention.rows.map((r) => r.label), ['Dag 1', 'Dag 7', 'Måned 1']);
  assert.deepEqual(by.retention.rows.slice(1).map((r) => r.value), [MISSING, MISSING]);
  for (const id of ['events', 'platforms', 'versions', 'languages', 'providerClicks', 'legacy']) assert.deepEqual(by[id].rows, [{ label: MISSING, value: MISSING }], id);
  const legacy = statsView(summary({ legacy: { visits: 5400, features: { inspire_search: 800 } } }), t, 'nb').find((s) => s.id === 'legacy');
  assert.deepEqual(legacy.rows.map((r) => r.label), [t.stats.legacyNames.visits, t.stats.legacyNames.features, 'inspire_search']);
});

test('the event names are PlanTravel’s own file, copied unchanged and embedded only in its admin page', () => {
  const page = read('admin/plantravel.html');
  assert.ok(page.includes(`var NAMES = ${JSON.stringify(NAMES).replace(/</g, '\u003c')};`));
  assert.doesNotMatch(read('admin/saldo-pocket.html'), /var NAMES/);
  for (const l of CORE_LANGUAGES) assert.ok(NAMES[l.code], `${l.code} names`);
  for (const l of CORE_LANGUAGES) assert.equal(JSON.parse(read(`i18n/home/${l.code}.json`)).admin.stats.eventNames, undefined, `${l.code}: never typed in here`);
  assert.match(read('package.json'), /"check": "[^"]*npm run check:plantravel/);
});

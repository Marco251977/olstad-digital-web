// /admin/plantravel and /admin/saldo-pocket (Marco 24.–25.10): ONE page for both. The numbers come from PlanTravel's
// GET /stats/summary and Saldo's stats-summary, fetched on the website's server side with keys that never reach the browser;
// only signed-in addresses on the allowlist get them; a missing number says «No data yet», never 0.
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

// PlanTravel's format (docs/stats-summary.md in the PlanTravel repo), shortened.
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const BLOCK = (byDay, firstDate = '2026-10-25') => ({
  firstDate,
  total: sum(byDay),
  byDay,
  byWeek: { '2026-W43': sum(Object.fromEntries(Object.entries(byDay).filter(([k]) => k <= '2026-10-25'))), '2026-W44': sum(Object.fromEntries(Object.entries(byDay).filter(([k]) => k > '2026-10-25'))) },
  byMonth: { '2026-10': sum(byDay) },
});
const STORE_DAY = (o = {}) => ({ downloads: null, redownloads: null, uninstalls: null, active_devices: null, page_views: null, store_acquisitions: null, crashes: null, anrs: null, ...o });
const SAMPLE = {
  period: { from: '2026-10-25', to: '2026-10-27', days: 3 },
  active: { day: 12, week: 48, month: 130 },
  retention: { day1: 0.42, day7: null, month1: null },
  onboarding: { started: 60, done: 60, skipped: null },
  events: { 'search_done:flight': 900, app_active: 450, not_named_yet: 7 },
  platforms: { ios: 80, android: 45, web: 5 },
  versions: { '1.0.9': 120 },
  languages: { nb: 90, en: 40 },
  providerClicks: {
    from: '2026-10-25',
    total: 6,
    byProvider: { booking: BLOCK({ '2026-10-25': 0, '2026-10-26': 2, '2026-10-27': 0 }), kiwi: BLOCK({ '2026-10-25': 3, '2026-10-26': 0, '2026-10-27': 0 }), kiwitaxi: BLOCK({ '2026-10-25': 0, '2026-10-26': 0, '2026-10-27': 1 }) },
    byType: { car: BLOCK({ '2026-10-25': 0, '2026-10-26': 0, '2026-10-27': 1 }), flight: BLOCK({ '2026-10-25': 3, '2026-10-26': 0, '2026-10-27': 0 }), hotel: BLOCK({ '2026-10-25': 0, '2026-10-26': 2, '2026-10-27': 0 }) },
  },
  consent: { yes: 2, no: 1, answered: 3, shareYes: 0.6667, firstDate: '2026-10-26', byDay: { '2026-10-26': { yes: 2, no: 1 }, '2026-10-27': { yes: 0, no: 0 } }, byPlatform: { ios: { yes: 2, no: 0 }, android: { yes: 0, no: 1 } }, shareOfActiveDevices: { value: 0.0488, estimate: true, basis: 'store_active_devices', devices: 41, reason: 'ios_active_devices_not_available' } },
  db: { newAccounts: BLOCK({ '2026-10-24': 2, '2026-10-25': 0, '2026-10-26': 1, '2026-10-27': 0 }, '2026-10-24'), newPlans: BLOCK({ '2026-10-24': 3, '2026-10-25': 0, '2026-10-26': 0, '2026-10-27': 2 }, '2026-10-24'), activePlans: 96 },
  stores: {
    ios: { fetchedAt: '2026-10-27T04:10:02.000Z', reason: null, firstDate: '2026-10-25', days: { '2026-10-25': STORE_DAY({ downloads: 6, redownloads: 1 }), '2026-10-26': STORE_DAY({ downloads: 4, redownloads: 0 }), '2026-10-27': STORE_DAY() }, byWeek: { '2026-W43': STORE_DAY({ downloads: 6, redownloads: 1 }), '2026-W44': STORE_DAY({ downloads: 4, redownloads: 0 }) }, byMonth: { '2026-10': STORE_DAY({ downloads: 10, redownloads: 1 }) }, countries: { NO: { downloads: 9, uninstalls: null, page_views: null }, SE: { downloads: 1, uninstalls: null, page_views: null } }, reasons: { uninstalls: 'apple_analytics_not_requested', active_devices: 'not_on_ios' } },
    android: { fetchedAt: '2026-10-27T04:10:05.000Z', reason: null, firstDate: '2026-10-25', days: { '2026-10-25': STORE_DAY({ downloads: 3, uninstalls: 1, active_devices: 41, page_views: 120, store_acquisitions: 4, crashes: 0, anrs: 0 }) }, countries: { NO: { downloads: 3, uninstalls: 1, page_views: 110 }, ZZ: { downloads: null, uninstalls: null, page_views: 10 } }, reasons: { redownloads: 'not_on_android' } },
    note: 'store_counts_include_own_devices',
  },
  includesTest: false,
};

/** A fetch that answers Supabase (the token «good» = the allowed owner) and the app's server (reply). Records every call. */
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
  assert.equal(body.data.key, undefined);
  assert.equal(body.data.users, undefined);
  assert.equal(body.data.db.activePlans, 96);
  assert.equal(body.data.stores.note, 'store_counts_include_own_devices');
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
  assert.match(read('admin/saldo-pocket.html'), /id="include-test"/, 'every app with a source has the switch');
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
  assert.match(page, /if \(!j\.status\) return \['offline', ''\];/, 'no answer at all = the offline text');
  for (const l of CORE_LANGUAGES) {
    const a = JSON.parse(read(`i18n/home/${l.code}.json`)).admin;
    for (const k of ['statsNotConfigured', 'sourceRefused', 'sourceFailed', 'loading', 'retry', 'includeTest', 'offline', 'noData']) assert.ok(a[k], `${l.code} ${k}`);
  }
});

test('the keys and their names are never in a generated page or the browser script', () => {
  const files = ['admin.html', ...fs.readdirSync(new URL('../admin/', import.meta.url)).map((f) => `admin/${f}`), 'assets/admin-stats.js'];
  for (const f of files) {
    assert.doesNotMatch(read(f), /PLANTRAVEL_|SALDO_|STATS_KEY|api\.plantravel|stats\/summary|stats-summary|exchange-rates/, f);
  }
  const example = read('.env.example');
  for (const name of ['ADMIN_EMAILS', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'PLANTRAVEL_API_URL', 'PLANTRAVEL_STATS_KEY', 'SALDO_STATS_URL', 'SALDO_STATS_KEY']) assert.match(example, new RegExp(`^${name}=$`, 'm'), `${name} without a value`);
});

const textsFor = (lang) => JSON.parse(JSON.stringify(JSON.parse(read(`i18n/home/${lang}.json`)).admin).replace(/\{\{(\w+)\}\}/g, '%$1%'));
const byId = (view) => Object.fromEntries(view.map((s) => [s.id, s]));
const NONE = 'Ingen data ennå';

test('missing (null) values say «No data yet» – never 0; a real 0 stays 0', () => {
  const t = textsFor('nb');
  assert.equal(t.stats.noDataYet, NONE);
  const data = summary({ active: { day: null, week: 'many', month: 0 }, events: { a: null }, retention: { day1: null }, db: { newAccounts: { total: 0 }, activePlans: null }, includesTest: true });
  assert.deepEqual(data.active, { day: null, month: 0 }, 'text where a number belongs is dropped');
  const by = byId(statsView(data, t, 'nb'));
  assert.deepEqual(by.active.tiles.map((x) => x.value), [NONE, NONE, '0']);
  assert.deepEqual(by.db.tiles.map((x) => x.value), ['0', NONE, NONE]);
  assert.equal(by.retention.rows[0].value, NONE);
  assert.equal(by.events.empty, NONE);
  assert.equal(by.period.text, NONE);
  assert.equal(by.period.note, t.stats.withTest);
  // A block the source did not send (null) = the section says «No data yet».
  for (const id of ['providerClicks', 'consent', 'stores']) assert.equal(by[id].empty, NONE, id);
  // An empty answer: PlanTravel's blocks, each «No data yet».
  assert.deepEqual(byId(statsView(summary({}), t, 'nb')).active.tiles.map((x) => x.value), [NONE, NONE, NONE]);
});

test('PlanTravel: every block of /stats/summary has a section, laid out in the page language', () => {
  const t = textsFor('nb');
  const view = statsView(summary(SAMPLE), t, 'nb', NAMES.nb);
  assert.deepEqual(view.map((s) => s.id), ['period', 'active', 'db', 'providerClicks', 'consent', 'stores', 'retention', 'onboarding', 'events', 'platforms', 'versions', 'languages']);
  const by = byId(view);
  assert.deepEqual(by.active.tiles.map((x) => x.value), ['12', '48', '130']);
  assert.deepEqual(by.db.tiles.map((x) => x.value), ['3', '5', '96']);
  assert.deepEqual(by.db.series.views.week.map((r) => [r.label, ...r.cells]), [['Uke 44 2026', '1', '2'], ['Uke 43 2026', '2', '3']]);
  assert.deepEqual(by.providerClicks.groups[0].rows.map((r) => [r.label, r.value]), [['kiwi', '3'], ['booking', '2'], ['kiwitaxi', '1']]);
  assert.deepEqual(by.providerClicks.groups[1].rows.map((r) => r.label), [NAMES.nb['provider_click:flight'], NAMES.nb['provider_click:hotel'], NAMES.nb['provider_click:car']]);
  assert.deepEqual(by.providerClicks.series.views.day[0].cells, ['1', '1', '0', '0'], 'newest day first: total, then car/flight/hotel');
  const share = new Intl.NumberFormat('nb', { style: 'percent', maximumFractionDigits: 1 });
  assert.deepEqual(by.consent.tiles.map((x) => x.value), ['2', '1', '3', share.format(0.6667)]);
  assert.equal(by.consent.groups[0].rows[0].value, `ca. ${share.format(0.0488)}`);
  assert.ok(by.consent.groups[0].notes.some((n) => n.includes('41')));
  assert.ok(by.consent.groups[0].notes.includes(t.stats.reasons.ios_active_devices_not_available));
  // Stores: only the metrics with numbers become columns; the others are listed with their reason; weeks/months as sent.
  const [ios, android] = by.stores.parts;
  assert.deepEqual(by.stores.notes, [t.stats.notes.store_counts_include_own_devices]);
  assert.deepEqual(ios.series.columns, [t.stats.metrics.downloads, t.stats.metrics.redownloads]);
  assert.deepEqual(ios.series.views.month.map((r) => r.cells), [['10', '1']]);
  assert.ok(ios.notes.includes(`${t.stats.metrics.uninstalls}: ${t.stats.reasons.apple_analytics_not_requested}`));
  const region = new Intl.DisplayNames(['nb'], { type: 'region' });
  assert.deepEqual(ios.table.rows.map((r) => r.label), [region.of('NO'), region.of('SE')]);
  assert.ok(android.series.columns.includes(t.stats.metrics.crashes), 'a real 0 is data');
  assert.deepEqual(android.series.views.week[0].cells.slice(-2), ['0', '0']);
  assert.equal(android.table.rows.at(-1).label, t.stats.countryOther);
  assert.deepEqual(android.table.rows.at(-1).cells, [MISSING, MISSING, '10'], 'a missing cell is «–» (with the legend), never 0');
  assert.deepEqual(by.retention.rows.map((r) => [r.label, r.value]), [['Dag 1', share.format(0.42)], ['Dag 7', NONE], ['Måned 1', NONE]]);
  assert.deepEqual(by.onboarding.rows.map((r) => [r.label, r.value]), [['Startet', '60'], ['Fullført', '60'], ['Hoppet over', NONE]]);
  assert.deepEqual(by.events.rows.map((r) => r.label), [NAMES.nb['search_done:flight'], NAMES.nb.app_active, 'not_named_yet'], 'PlanTravel’s names, the id when missing');
  assert.deepEqual(by.platforms.rows.map((r) => r.label), ['iOS', 'Android', 'Web']);
  assert.equal(by.languages.rows[0].label, new Intl.DisplayNames(['nb'], { type: 'language' }).of('nb'));
  for (const l of CORE_LANGUAGES) {
    const v = statsView(summary(SAMPLE), textsFor(l.code), l.code, NAMES[l.code]);
    assert.ok(!/%\w+%|undefined|\[object/.test(JSON.stringify(v)), `${l.code}: every text and placeholder filled`);
  }
});

// Saldo's format (docs/store-stats.md in the Saldo repo): stores with days only, revenue in EUR, usage null.
const SALDO = {
  period: { from: '2026-10-25', to: '2026-10-27', days: 3 },
  stores: {
    note: 'store_counts_include_own_devices',
    ios: { fetchedAt: '2026-10-27T12:04:10.753+00:00', reason: 'apple_analytics:no_ongoing_request', days: { '2026-10-25': STORE_DAY({ downloads: 2 }), '2026-10-26': STORE_DAY({ downloads: 3 }), '2026-10-27': STORE_DAY() }, countries: { NO: { downloads: 5, uninstalls: null, page_views: null } } },
    android: { fetchedAt: '2026-10-27T12:04:10.753+00:00', reason: 'google_play:no_files', days: { '2026-10-25': STORE_DAY() }, countries: {} },
  },
  revenue: {
    note: 'includes_own_purchases',
    currency: 'EUR',
    fetchedAt: '2026-10-27T12:04:10.753+00:00',
    asOf: '2026-10-27',
    current: {
      monthly: { ios: { active_subscriptions: 1, active_trials: 0, mrr: 4.99 }, android: { active_subscriptions: null, active_trials: null, mrr: null }, all: { active_subscriptions: 1, active_trials: 0, mrr: 4.99 } },
      all: { ios: { active_subscriptions: 1, active_trials: 0, mrr: 4.99 }, android: { active_subscriptions: 0, active_trials: 0, mrr: 0 }, all: { active_subscriptions: 1, active_trials: 0, mrr: 4.99 } },
    },
    days: { '2026-10-25': { revenue: 4.99, new_customers: 1, cancellations: 0 }, '2026-10-26': { revenue: null, new_customers: null, cancellations: null } },
  },
  usage: null,
  secret: 'x',
};
const RATES = { ok: true, base: 'EUR', stale: false, date: '2026-10-25', rates: { NOK: 10.5, SEK: 11.2 } };
const SALDO_ENV = { ...ENV, SALDO_STATS_URL: 'https://saldo.supabase.example/functions/v1/stats-summary', SALDO_STATS_KEY: 'saldo-secret-987', SUPABASE_ANON_KEY: 'anon-public' };

const saldoFetch = (rates = () => new Response(JSON.stringify(RATES), { status: 200 })) =>
  fakeFetch((url) => (String(url).includes('/exchange-rates') ? rates(url) : new Response(JSON.stringify(SALDO), { status: 200 })));
const saldoStats = (env, fetcher) =>
  handle(new Request('https://h/api/admin', { method: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify({ action: 'stats', app: 'saldo-pocket' }) }), env, fetcher);

test('Saldo: stats-summary with its own key from the server, the revenue also in NOK «ca.» from Saldo’s exchange-rate service', async () => {
  const f = saldoFetch();
  const r = await saldoStats(SALDO_ENV, f.fetcher);
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!text.includes('saldo-secret-987') && !text.includes('anon-public'), 'no key in the answer');
  const body = JSON.parse(text);
  assert.deepEqual(Object.keys(body.data), ['period', 'stores', 'revenue', 'usage', 'includesTest']);
  const summaryCall = f.calls.find((c) => c.url.includes('/stats-summary'));
  assert.equal(summaryCall.url, 'https://saldo.supabase.example/functions/v1/stats-summary?includeTest=0');
  assert.equal(summaryCall.init.headers.authorization, 'Bearer saldo-secret-987');
  const ratesCall = f.calls.find((c) => c.url.includes('/exchange-rates'));
  assert.equal(ratesCall.url, 'https://saldo.supabase.example/functions/v1/exchange-rates');
  assert.equal(ratesCall.init.headers.apikey, 'anon-public');
  const conv = body.data.revenue.converted;
  assert.deepEqual([conv.currency, conv.rate, conv.date, conv.stale], ['NOK', 10.5, '2026-10-25', false]);
  assert.equal(conv.current.monthly.all.mrr, 52.4, '4.99 EUR × 10.5 = 52.40 NOK (rounded to øre)');
  assert.equal(conv.current.monthly.android.mrr, null, 'missing stays missing');
  assert.deepEqual(conv.days['2026-10-26'], { revenue: null });

  const t = textsFor('nb');
  const by = byId(statsView(body.data, t, 'nb'));
  assert.deepEqual(Object.keys(by), ['period', 'revenue', 'stores', 'usage']);
  const eur = (v) => new Intl.NumberFormat('nb', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v);
  const nok = (v) => `ca. ${new Intl.NumberFormat('nb', { style: 'currency', currency: 'NOK', maximumFractionDigits: 2 }).format(v)}`;
  const [plans, platforms] = by.revenue.tables;
  assert.deepEqual(plans.rows.map((row) => row.label), ['Månedlig', 'Alle planer']);
  assert.deepEqual(plans.rows[0].cells, ['1', '0', eur(4.99), nok(52.4)]);
  assert.deepEqual(platforms.rows.map((row) => [row.label, ...row.cells]), [['iOS', '1', '0', eur(4.99), nok(52.4)], ['Android', '0', '0', eur(0), nok(0)]]);
  assert.ok(by.revenue.notes.some((n) => n.startsWith('1 EUR = 10,5 NOK')), 'the rate line with its date');
  assert.ok(by.revenue.notes.includes(t.stats.notes.includes_own_purchases));
  assert.deepEqual(by.revenue.series.views.day.map((row) => row.cells), [[MISSING, MISSING, MISSING, MISSING], [eur(4.99), nok(52.4), '1', '0']]);
  // Stores: days only → weeks and months summed here; reasons per source as text.
  const [ios, android] = by.stores.parts;
  assert.deepEqual(ios.series.views.week.map((row) => [row.label, ...row.cells]), [['Uke 44 2026', '3'], ['Uke 43 2026', '2']], '25.10.2026 is a Sunday (ISO week 43)');
  assert.deepEqual(ios.series.views.month.map((row) => row.cells), [['5']]);
  assert.ok(ios.notes[0].startsWith('Apple Analytics: '));
  assert.equal(android.empty, NONE);
  assert.ok(android.notes[0].startsWith('Google Play: ') && android.notes[0].includes(t.stats.reasons.no_files));
  assert.equal(by.usage.empty, NONE);
});

test('Saldo: no exchange rate = said so, never 0 – the EUR numbers are still shown', async () => {
  const t = textsFor('nb');
  for (const reply of [() => new Response('{}', { status: 500 }), () => { throw new TypeError('fetch failed'); }, () => new Response(JSON.stringify({ ...RATES, rates: { SEK: 11 } }), { status: 200 })]) {
    const body = await (await saldoStats(SALDO_ENV, saldoFetch(reply).fetcher)).json();
    const conv = body.data.revenue.converted;
    assert.deepEqual([conv.currency, conv.rate], ['NOK', null]);
    const rev = byId(statsView(body.data, t, 'nb')).revenue;
    assert.ok(rev.notes.includes(t.stats.rateMissing.replace('%currency%', 'NOK')));
    assert.equal(rev.tables[0].rows[0].cells[3], MISSING, 'NOK cell «–», not 0');
    assert.notEqual(rev.tables[0].rows[0].cells[2], MISSING, 'EUR still shown');
  }
});

test('the view is written with textContent only – a server value is never read as HTML', () => {
  const made = [];
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this._text = ''; this.style = {}; made.push(this); }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text; }
    set innerHTML(v) { throw new Error('innerHTML used'); }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    addEventListener() {}
    appendChild(c) { this.children.push(c); return c; }
  }
  const doc = { createElement: (tag) => new El(tag) };
  const box = new El('div');
  const t = textsFor('en');
  renderStats(box, statsView(summary({ ...SAMPLE, events: { '<img src=x onerror=alert(1)>': 1, ok: 2 } }), t, 'en', NAMES.en), t, doc);
  renderStats(box, statsView(summary(SALDO, 'saldo'), t, 'en'), t, doc);
  assert.ok(made.some((e) => e.textContent === 'ok'));
  assert.ok(!made.some((e) => /<img/.test(e.textContent)));
  assert.ok(made.some((e) => e.tag === 'table'), 'tables for the series');
  assert.doesNotMatch(read('assets/admin-stats.js'), /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  for (const page of ['admin/plantravel.html', 'admin/saldo-pocket.html']) assert.doesNotMatch(read(page), /innerHTML|insertAdjacentHTML/);
});

test('only aggregate numbers pass: no arrays, no free text, no e-mail address, strings only as codes and dates', () => {
  const dirty = summary({ ...SAMPLE, events: { 'a@b.c': 1, ok: 2 }, consent: { ...SAMPLE.consent, basis: 'Some free text here', note: 'x@y' }, db: { ...SAMPLE.db, list: [1, 2], name: 'Marco' }, stores: { ...SAMPLE.stores, note: 'see https://x' } });
  assert.deepEqual(dirty.events, { ok: 2 });
  assert.equal(dirty.consent.basis, null);
  assert.equal(dirty.consent.note, null);
  assert.equal(dirty.db.list, undefined);
  assert.equal(dirty.db.name, undefined);
  assert.equal(dirty.stores.note, null);
  assert.equal(summary(SALDO, 'saldo').secret, undefined, 'unknown top-level fields are dropped');
});

test('«Til godkjenning» at the top of every app page: PlanTravel opens its own queue unchanged, Saldo has none', () => {
  const pt = read('admin/plantravel.html');
  const saldo = read('admin/saldo-pocket.html');
  for (const page of [pt, saldo]) assert.ok(page.indexOf('data-t="approval"') < page.indexOf('admin-app-head'), 'the button comes before the app heading');
  assert.match(pt, /<a class="btn primary" href="https:\/\/plantravelapp\.com\/admin\/approval-queue" target="_blank" rel="noopener"><span data-t="approval">/);
  assert.match(saldo, /id="approval-open"/);
  assert.match(saldo, /data-t="approvalEmpty" hidden/);
  for (const l of CORE_LANGUAGES) {
    const a = JSON.parse(read(`i18n/home/${l.code}.json`)).admin;
    for (const k of ['approval', 'approvalHint', 'approvalEmpty', 'offline']) assert.ok(a[k], `${l.code} ${k}`);
    for (const k of ['store_counts_include_own_devices', 'includes_own_purchases']) assert.ok(a.stats.notes[k], `${l.code} ${k}`);
  }
  assert.equal(JSON.parse(read('i18n/home/nb.json')).admin.approval, 'Til godkjenning');
  assert.equal(JSON.parse(read('i18n/home/nb.json')).admin.approvalEmpty, 'Ingenting venter på godkjenning.');
});

test('the event names are PlanTravel’s own file, copied unchanged and embedded only in its admin page', () => {
  const page = read('admin/plantravel.html');
  assert.ok(page.includes(`var NAMES = ${JSON.stringify(NAMES).replace(/</g, '<')};`));
  assert.doesNotMatch(read('admin/saldo-pocket.html'), /var NAMES/);
  for (const l of CORE_LANGUAGES) assert.ok(NAMES[l.code], `${l.code} names`);
  for (const l of CORE_LANGUAGES) assert.equal(JSON.parse(read(`i18n/home/${l.code}.json`)).admin.stats.eventNames, undefined, `${l.code}: never typed in here`);
  assert.match(read('package.json'), /"check": "[^"]*npm run check:plantravel/);
});

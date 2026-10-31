// /admin/plantravel and /admin/saldo-pocket (Marco 24.–25.10): ONE page for both. The numbers come from PlanTravel's
// GET /stats/summary and Saldo's stats-summary, fetched on the website's server side with keys that never reach the browser;
// only signed-in addresses on the allowlist get them; a missing number says «No data yet», never 0.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { CORE_LANGUAGES } from 'app-core';

import { handle } from '../api/admin.js';
import { SESSION_COOKIE, sessionValue } from '../lib/admin-auth.js';
import { channelsSection, consentIn, MISSING, mountStats, PAGE, periodBar, periodRange, PERIODS, renderStats, statsView } from '../assets/admin-stats.js';
import { summary } from '../lib/stats.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const NAMES = JSON.parse(read('data/plantravel-event-names.json')).names;
const SECRET = 'pt-secret-key-123456';
const ENV = { ADMIN_EMAILS: 'owner@example.com', ADMIN_PASSWORD_HASH: '$2b$04$test.hash.only.for.signing.cookies..', ADMIN_SESSION_SECRET: 'test-session-secret', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', PLANTRAVEL_API_URL: 'https://api.plantravel.example/', PLANTRAVEL_STATS_KEY: SECRET };

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

/** The session cookie the server sets after sign-in: «good» = the allowed owner, «other» = an address not on the list. */
const session = (who, env = ENV) => (who ? { cookie: `${SESSION_COOKIE}=${sessionValue(who === 'good' ? 'owner@example.com' : 'other@example.com', env)}` } : {});
const stats = (body, who, env = ENV, fetcher) =>
  handle(new Request('https://h/api/admin', { method: 'POST', headers: session(who, env), body: JSON.stringify({ action: 'stats', app: 'plantravel', ...body }) }), env, fetcher);

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
  assert.equal(by.period, undefined, 'the period is the choice at the top, not a card');
  assert.equal(periodBar(data, t, 'nb').text, NONE);
  assert.equal(periodBar(data, t, 'nb').note, t.stats.withTest);
  // A block the source did not send (null) = the section says «No data yet».
  for (const id of ['providerClicks', 'consent', 'stores']) assert.equal(by[id].empty, NONE, id);
  // An empty answer: PlanTravel's blocks, each «No data yet».
  assert.deepEqual(byId(statsView(summary({}), t, 'nb')).active.tiles.map((x) => x.value), [NONE, NONE, NONE]);
});

test('PlanTravel: every block of /stats/summary has a section, laid out in the page language', () => {
  const t = textsFor('nb');
  const view = statsView(summary(SAMPLE), t, 'nb', NAMES.nb);
  assert.deepEqual(view.map((s) => s.id), ['active', 'db', 'providerClicks', 'consent', 'stores', 'retention', 'onboarding', 'events', 'channels', 'platforms', 'versions', 'languages']);
  const by = byId(view);
  assert.equal(by.channels.empty, NONE, '(26.10) no channels block from the server yet = «No data yet», never 0');
  assert.deepEqual(by.active.tiles.map((x) => x.value), ['12', '48', '130']);
  assert.deepEqual(by.db.tiles.map((x) => x.value), ['3', '5', '96']);
  assert.deepEqual(by.db.series.views.week.map((r) => [r.label, ...r.cells]), [['Uke 44 2026', '1', '2'], ['Uke 43 2026', '2', '3']]);
  assert.deepEqual(by.providerClicks.groups[0].rows.map((r) => [r.label, r.value]), [['kiwi', '3'], ['booking', '2'], ['kiwitaxi', '1']]);
  assert.deepEqual(by.providerClicks.groups[1].rows.map((r) => r.label), [NAMES.nb['provider_click:flight'], NAMES.nb['provider_click:hotel'], NAMES.nb['provider_click:car']]);
  assert.deepEqual(by.providerClicks.series.views.day[0].cells, ['1', '1', '0', '0'], 'newest day first: total, then car/flight/hotel');
  const share = new Intl.NumberFormat('nb', { style: 'percent', maximumFractionDigits: 1 });
  assert.deepEqual(by.consent.tiles.map((x) => x.value), ['2', '1', '3', share.format(0.6667)]);
  assert.equal(by.consent.groups, undefined, '«Share of active devices» is gone (yes / store devices was misleading)');
  assert.ok(!JSON.stringify(by.consent).includes(share.format(0.0488)));
  // Stores: only the metrics with numbers become columns; the others are listed with their reason; weeks/months as sent.
  const [ios, android] = by.stores.parts;
  assert.deepEqual(by.stores.notes, [t.stats.notes.store_counts_include_own_devices]);
  assert.deepEqual(ios.series.columns, [t.stats.metrics.downloads, t.stats.metrics.redownloads]);
  assert.deepEqual(ios.series.views.month.map((r) => r.cells), [['10', '1']]);
  assert.ok(ios.notes.includes(`${t.stats.metrics.uninstalls}: ${t.stats.reasons.apple_analytics_not_requested}`));
  assert.ok(!ios.notes.some((n) => n.startsWith(t.stats.metrics.active_devices)), 'a metric that does not exist on iOS is not listed');
  assert.ok(!android.notes.some((n) => n.startsWith(t.stats.metrics.redownloads)), 'nor one that does not exist on Android');
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
  handle(new Request('https://h/api/admin', { method: 'POST', headers: session('good', env), body: JSON.stringify({ action: 'stats', app: 'saldo-pocket' }) }), env, fetcher);

test('Saldo: stats-summary with its own key from the server, the revenue also in NOK «ca.» from Saldo’s exchange-rate service', async () => {
  const f = saldoFetch();
  const r = await saldoStats(SALDO_ENV, f.fetcher);
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!text.includes('saldo-secret-987') && !text.includes('anon-public'), 'no key in the answer');
  const body = JSON.parse(text);
  assert.deepEqual(Object.keys(body.data), ['period', 'stores', 'revenue', 'includesTest'], 'usage (always null, no source) is not kept');
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
  assert.deepEqual(Object.keys(by), ['revenue', 'stores']);
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

test('(30.10) supplier clicks: the test clicks are always shown as their own number; an older answer shows nothing new', () => {
  const t = textsFor('nb');
  const st = t.stats;
  const fill = (x, v) => x.replace(/%(\w+)%/g, (_, k) => v[k]);
  const ZERO = { from: '2026-10-25', total: 0, byProvider: {}, byType: {} };
  const test = { total: 4, byProvider: { kiwi: 3, stay22: 1 }, byType: { flight: 3, hotel: 1 } };
  const view = (pc, includesTest = false, period) => byId(statsView(summary({ ...SAMPLE, providerClicks: pc, includesTest }), t, 'nb', NAMES.nb, { period, today: '2026-10-27' })).providerClicks;
  // 0 real + 4 test (Marco 30.10): Total 0, Test traffic 4, the lists name the test clicks, «only test traffic» instead of «No data yet».
  const only = view({ ...ZERO, test });
  assert.deepEqual(only.tiles.map((x) => [x.label, x.value]), [[st.total, '0'], [st.testTraffic, '4']]);
  const escape = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shape = (text) => new RegExp(`^${text.split('%date%').map(escape).join('.+')}$`);
  assert.match(only.notes[0], shape(st.testClicksExcluded), 'the date of the start, and «not in Total»');
  assert.equal(only.notes[1], fill(st.testClicksByProvider, { list: 'kiwi 3 · stay22 1' }));
  assert.equal(only.notes[2], fill(st.testClicksByType, { list: `${NAMES.nb['provider_click:flight']} 3 · ${NAMES.nb['provider_click:hotel']} 1` }));
  assert.deepEqual(only.groups.map((g) => [g.rows.length, g.empty]), [[0, st.onlyTestClicks], [0, st.onlyTestClicks]]);
  assert.ok(!JSON.stringify(only).includes(NONE), '«No data yet» never hides the test clicks');
  // Real + test: both numbers; with «Include test traffic» on the note says they are in Total.
  const both = view({ ...SAMPLE.providerClicks, test }, true);
  assert.deepEqual(both.tiles.map((x) => x.value), ['6', '4']);
  assert.match(both.notes[0], shape(st.testClicksIncluded));
  assert.equal(both.groups[0].rows.length, 3);
  // A chosen period: the test number is all since the start (said in the note), Total follows the period.
  assert.equal(view({ ...SAMPLE.providerClicks, test }, false, 'today').tiles[1].value, '4');
  // 0 test clicks: the 0 is shown, no lists, groups say «No data yet» as before.
  const none = view({ ...ZERO, test: { total: 0, byProvider: {}, byType: {} } });
  assert.deepEqual(none.tiles.map((x) => x.value), ['0', '0']);
  assert.deepEqual(none.notes.filter(Boolean).length, 1);
  assert.equal(none.groups[0].empty, NONE);
  // An older server without `test`: exactly as before (one tile, no notes, «No data yet»).
  const old = view(ZERO);
  assert.deepEqual(old.tiles.map((x) => x.value), ['0']);
  assert.equal(old.notes, undefined);
  assert.equal(old.groups[0].empty, NONE);
  assert.deepEqual(view(SAMPLE.providerClicks).tiles.length, 1);
  // The website's server keeps the block as it is (numbers under known names only).
  assert.deepEqual(summary({ providerClicks: { ...ZERO, test: { ...test, byProvider: { kiwi: 3, 'a@b.c': 2, bad: 'x' } } } }).providerClicks.test, { ...test, byProvider: { kiwi: 3 } });
});

test('(30.10) supplier clicks: names from the server list, per source (app / web); an older answer shows ids and no source', () => {
  const t = textsFor('nb');
  const st = t.stats;
  const day = { firstDate: '2026-10-25', total: 0, byDay: {}, byWeek: {}, byMonth: {} };
  const series = (n) => ({ ...day, total: n, byDay: { '2026-10-26': n } });
  const pc = {
    from: '2026-10-25', total: 5,
    byProvider: { hotelscom: series(2), discovercars: series(1), mystery: series(2) },
    byType: { hotel: series(2), car: series(1), flight: series(2) },
    bySource: { app: series(3), web: series(2) },
    names: { hotelscom: 'Hotels.com', discovercars: 'DiscoverCars' },
    test: { total: 3, byProvider: { hotelscom: 3 }, byType: { hotel: 3 }, bySource: { web: 3 } },
  };
  const view = (p) => byId(statsView(summary({ ...SAMPLE, providerClicks: p }), t, 'nb', NAMES.nb, { today: '2026-10-27' })).providerClicks;
  const v = view(pc);
  const labels = v.groups[0].rows.map((r) => r.label).sort();
  assert.deepStrictEqual(labels, ['DiscoverCars', 'Hotels.com', 'mystery'], 'name from the list, unknown id = the id');
  const src = v.groups.find((g) => g.title === st.bySource);
  assert.ok(src, 'the per-source group');
  assert.deepStrictEqual(src.rows.map((r) => [r.label, r.value]).sort(), [[st.clickSourceNames.app, '3'], [st.clickSourceNames.web, '2']].sort());
  assert.ok(v.notes.includes(st.testClicksByProvider.replace('%list%', 'Hotels.com 3')), 'the test list uses the name');
  assert.ok(v.notes.some((n) => n && n.includes(`${st.clickSourceNames.web} 3`)), 'test clicks per source');
  // An older server: no names, no bySource = the ids, two groups, exactly as before.
  const old = view({ ...pc, names: undefined, bySource: undefined, test: { total: 3, byProvider: { hotelscom: 3 }, byType: { hotel: 3 } } });
  assert.deepStrictEqual(old.groups.length, 2);
  assert.deepStrictEqual(old.groups[0].rows.map((r) => r.label).sort(), ['discovercars', 'hotelscom', 'mystery']);
  // The website's server keeps only short brand names, never a sentence, HTML or an e-mail.
  const kept = summary({ providerClicks: { ...pc, names: { kiwi: 'Kiwi.com', a: '<b>x</b>', b: 'x@y.no', c: 'A very long sentence that is clearly not a brand name at all' } } }).providerClicks.names;
  assert.deepStrictEqual(kept, { kiwi: 'Kiwi.com' });
  // Every language has the new texts.
  for (const lang of ['nb', 'en', 'ar', 'zh-Hans']) {
    const s = textsFor(lang).stats;
    assert.ok(s.bySource && s.clickSourceNames.app && s.clickSourceNames.web && s.testClicksBySource.includes('%list%'), lang);
    assert.notStrictEqual(s.sourceNames.revenuecat, undefined, 'the store sources keep their own names');
  }
});

test('(30.10) «Aktive på nettsiden» is its own number; an older server shows the page as before', () => {
  const t = textsFor('nb');
  const ids = (sum) => statsView(sum, t, 'nb', NAMES.nb, { today: '2026-10-27' }).map((x) => x.id);
  const withWeb = summary({ ...SAMPLE, activeWeb: { day: 3, week: 10, month: 25 } });
  const v = byId(statsView(withWeb, t, 'nb', NAMES.nb, { today: '2026-10-27' }));
  assert.strictEqual(v.activeWeb.title, t.stats.activeWeb);
  assert.deepStrictEqual(v.activeWeb.tiles.map((x) => x.value), ['3', '10', '25']);
  assert.deepStrictEqual(v.active.tiles.map((x) => x.value), byId(statsView(summary(SAMPLE), t, 'nb', NAMES.nb, { today: '2026-10-27' })).active.tiles.map((x) => x.value), 'the app number is unchanged');
  assert.ok(!ids(summary(SAMPLE)).includes('activeWeb'), 'older server: no section');
  assert.ok(ids(withWeb).indexOf('activeWeb') === ids(withWeb).indexOf('active') + 1, 'right after Aktive brukere');
  for (const lang of ['nb', 'en', 'ar', 'zh-Hans']) assert.ok(textsFor(lang).stats.activeWeb, lang);
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

test('«Til godkjenning» at the top of every app page: the same button and queue for every app, behind the same sign-in', () => {
  const pt = read('admin/plantravel.html');
  const saldo = read('admin/saldo-pocket.html');
  for (const page of [pt, saldo]) {
    assert.ok(page.indexOf('data-t="approval"') < page.indexOf('admin-app-head'), 'the button comes before the app heading');
    assert.match(page, /<button class="btn primary" type="button" id="approval-open" aria-expanded="false" aria-controls="approval-panel">/);
    assert.match(page, /id="approval-panel" class="admin-queue" data-app="[a-z-]+" aria-live="polite" hidden/);
    assert.doesNotMatch(page, /plantravelapp\.com\/admin/, 'never the old admin');
  }
  for (const l of CORE_LANGUAGES) {
    const a = JSON.parse(read(`i18n/home/${l.code}.json`)).admin;
    for (const k of ['approval', 'approvalEmpty', 'offline', 'queueNotConfigured', 'queueSourceRefused', 'queueSourceFailed']) assert.ok(a[k], `${l.code} ${k}`);
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

// ---- Period choice, consent share, «Show 10 more» (Marco 25.10) ----

test('the period: today, this week (Monday), this month, year to date, last 12 months, all – ending on the UTC day', () => {
  const r = (p, d) => { const x = periodRange(p, d); return [x.from, x.to]; };
  assert.deepEqual(PERIODS, ['today', 'week', 'month', 'year', 'last12', 'all']);
  assert.deepEqual(r('today', '2026-10-25'), ['2026-10-25', '2026-10-25']);
  assert.deepEqual(r('week', '2026-10-25'), ['2026-10-19', '2026-10-25'], 'Sunday 25.10 → Monday 19.10');
  assert.deepEqual(r('week', '2026-10-26'), ['2026-10-26', '2026-10-26'], 'a Monday starts its own week');
  assert.deepEqual(r('month', '2026-10-25'), ['2026-10-01', '2026-10-25']);
  assert.deepEqual(r('year', '2026-10-25'), ['2026-01-01', '2026-10-25']);
  assert.deepEqual(r('last12', '2026-10-25'), ['2025-10-26', '2026-10-25']);
  assert.deepEqual(r('last12', '2028-02-29'), ['2027-03-01', '2028-02-29'], 'leap day');
  assert.deepEqual(r('all', '2026-10-25'), [null, '2026-10-25']);
});

test('every card that has numbers per day follows the period; totals-only numbers say which days they cover', () => {
  const t = textsFor('nb');
  const data = summary(SAMPLE);
  const view = (period) => byId(statsView(data, t, 'nb', NAMES.nb, { period, today: '2026-10-27' }));
  const today = view('today');
  assert.deepEqual(today.db.tiles.map((x) => x.value), ['0', '2', '96'], 'new accounts/plans on 27.10 only; active plans are now');
  assert.ok(today.db.notes.some((n) => n && n.includes(t.stats.activePlans)), 'active plans say they are a state now');
  assert.deepEqual(today.db.series.views.day.map((r) => r.cells), [['0', '2']]);
  assert.equal(today.providerClicks.tiles[0].value, '1');
  assert.deepEqual(today.providerClicks.groups[0].rows.map((r) => [r.label, r.value]), [['kiwitaxi', '1'], ['booking', '0'], ['kiwi', '0']]);
  assert.deepEqual(today.consent.tiles.map((x) => x.value), ['0', '0', '0', NONE], 'no answers that day: share = no data, never 0 %');
  const all = view('all');
  assert.deepEqual(all.db.tiles.map((x) => x.value), ['3', '5', '96']);
  assert.equal(all.db.note, 'Fra 24. okt. 2026', '«all»: from the first day with data');
  assert.equal(view('week').db.note, null, 'the data starts before the week (Monday 26.10): no «From»');
  assert.equal(view('month').db.note, 'Fra 24. okt. 2026', 'the data starts after 1.10: «From <date>»');
  assert.equal(byId(statsView(data, t, 'nb', NAMES.nb, { period: 'year', today: '2026-10-27' })).db.note, 'Fra 24. okt. 2026', 'starts after 1.1: «From <date>»');
  assert.equal(view('week').consent.note, null, 'first answer 26.10 = the first day of the week');
  assert.equal(view('month').consent.note, 'Fra 26. okt. 2026');
  // The stores: the days in the period, weeks and months summed from them; countries cover every day.
  const ios = today.stores.parts[0];
  assert.deepEqual(ios.series.views.day.map((r) => r.cells), [[MISSING, MISSING]]);
  assert.equal(ios.empty, null);
  assert.ok(ios.table.note.startsWith('Gjelder alle dager med data'));
  assert.equal(today.stores.parts[1].empty, t.stats.noDataInPeriod, 'Android has data, but not on 27.10');
  assert.deepEqual(view('month').stores.parts[0].series.views.week.map((r) => r.cells), [['4', '0'], ['6', '1']]);
  // Totals the server sends for its own window only: the window is said, whatever is chosen.
  for (const id of ['events', 'platforms', 'versions', 'languages', 'retention', 'onboarding']) assert.equal(today[id].note, 'Gjelder 25. okt. 2026 – 27. okt. 2026, uansett valgt periode.', id);
  assert.match(today.active.note, /^Dag, uke og måned fram til 27\. okt\. 2026/);
  // Saldo: revenue per day follows the period; subscriptions are the state on the newest day.
  const saldo = byId(statsView(summary(SALDO, 'saldo'), t, 'nb', {}, { period: 'today', today: '2026-10-26' }));
  assert.deepEqual(saldo.revenue.series.views.day.map((r) => r.cells[0]), [MISSING]);
  assert.ok(saldo.revenue.tables[0].note.includes('27. okt. 2026'));
  const bar = periodBar(SAMPLE, t, 'nb', 'month', '2026-10-27');
  assert.equal(bar.text, '1. okt. 2026 – 27. okt. 2026');
  assert.deepEqual(bar.choices.map((c) => [c.label, c.pressed]), [['I dag', false], ['Denne uken', false], ['Denne måneden', true], ['Hittil i år', false], ['Siste 12 måneder', false], ['Alt', false]]);
  assert.equal(periodBar(SAMPLE, t, 'nb', 'all', '2026-10-27').text, '24. okt. 2026 – 27. okt. 2026', '«all» shows the first day with data');
});

test('«Share yes» = yes / answered for the chosen period; there is no «share of active devices» any more', () => {
  assert.deepEqual(consentIn(SAMPLE.consent, periodRange('all', '2026-10-27')), { yes: 2, no: 1, answered: 3, shareYes: 2 / 3 });
  assert.deepEqual(consentIn(SAMPLE.consent, periodRange('today', '2026-10-27')), { yes: 0, no: 0, answered: 0, shareYes: null });
  assert.deepEqual(consentIn({ byDay: { '2026-10-26': { yes: 3, no: 1 } } }, periodRange('month', '2026-10-27')), { yes: 3, no: 1, answered: 4, shareYes: 0.75 });
  const t = textsFor('nb');
  const tiles = byId(statsView(summary(SAMPLE), t, 'nb', NAMES.nb)).consent.tiles;
  assert.deepEqual(tiles.map((x) => x.label), [t.stats.yes, t.stats.no, t.stats.answered, t.stats.shareYes]);
  for (const l of CORE_LANGUAGES) {
    const s = JSON.parse(read(`i18n/home/${l.code}.json`)).admin.stats;
    for (const k of ['shareOfActive', 'basisStore']) assert.equal(s[k], undefined, `${l.code} ${k} removed`);
    for (const k of PERIODS) assert.ok(s.periods[k], `${l.code} periods.${k}`);
    for (const k of ['showMore', 'shownOf', 'noDataInPeriod', 'coversUsage', 'coversActive', 'coversAllData', 'snapshot']) assert.ok(s[k], `${l.code} ${k}`);
  }
});

/** A small DOM: elements with children, attributes, listeners and click(). */
function fakeDom() {
  let focused = null;
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this._text = ''; this.style = {}; this.listeners = {}; this.hidden = false; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k]; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    click() { for (const fn of this.listeners.click ?? []) fn(); }
    appendChild(c) { this.children.push(c); return c; }
    querySelector(sel) { return this.children.find((c) => sel.split(', ').includes(c.tag)) ?? null; }
    focus() { focused = this; }
    all() { return [this, ...this.children.flatMap((c) => c.all())]; }
  }
  return { doc: { createElement: (tag) => new El(tag) }, focused: () => focused };
}

test('long tables and lists: 10 rows, then a real button «Show 10 more» until every row is shown', () => {
  const t = textsFor('nb');
  const dom = fakeDom();
  const box = dom.doc.createElement('div');
  const rows = Array.from({ length: 25 }, (_, i) => ({ label: `L${i}`, cells: [String(i)] }));
  renderStats(box, [{ id: 'x', title: 'X', rows: rows.map((r) => ({ label: r.label, value: r.cells[0] })), tables: [{ title: 'T', columns: ['n'], rows }] }], t, dom.doc);
  const tbody = box.all().find((e) => e.tag === 'tbody');
  const buttons = box.all().filter((e) => e.tag === 'button');
  assert.equal(PAGE, 10);
  assert.equal(buttons.length, 2, 'one for the list, one for the table');
  const [listButton, tableButton] = buttons;
  assert.equal(tbody.children.length, 10);
  assert.equal(tableButton.type, 'button');
  assert.equal(tableButton.textContent, 'Vis 10 til');
  assert.equal(tableButton.attrs['aria-controls'], tbody.id);
  const more = box.all().find((e) => e.children.includes(tableButton));
  const status = more.children[0];
  assert.equal(status.textContent, 'Viser 10 av 25');
  tableButton.click();
  assert.equal(tbody.children.length, 20);
  assert.equal(tbody.children[0].children[0].textContent, 'L0', 'the order is unchanged (newest first stays first)');
  assert.equal(dom.focused(), tbody.children[10].children[0], 'the focus goes to the first new row');
  assert.equal(tableButton.textContent, 'Vis 5 til');
  tableButton.click();
  assert.equal(tbody.children.length, 25);
  assert.equal(status.textContent, 'Viser 25 av 25');
  assert.equal(more.hidden, true, 'everything shown: the button goes away');
  const dl = box.all().find((e) => e.tag === 'dl');
  assert.equal(dl.children.length, 10);
  listButton.click();
  assert.equal(dl.children.length, 20);
  // 10 rows or fewer: no button.
  const small = dom.doc.createElement('div');
  renderStats(small, [{ id: 'y', title: 'Y', tables: [{ title: 'T', columns: ['n'], rows: rows.slice(0, 10) }] }], t, dom.doc);
  assert.equal(small.all().filter((e) => e.tag === 'button').length, 0);
  // Every series row is in the view (no cut at 31 days); the page shows 10 at a time.
  const daysView = statsView(summary(SAMPLE), t, 'nb', NAMES.nb).find((s) => s.id === 'stores').parts[0].series.views.day;
  assert.equal(daysView.length, 3);
});

test('the period buttons: real buttons in a labelled group, the chosen one aria-pressed, «all» by default', () => {
  const t = textsFor('nb');
  const dom = fakeDom();
  const box = dom.doc.createElement('div');
  const page = mountStats(box, summary(SAMPLE), t, 'nb', NAMES.nb, { today: '2026-10-27', period: 'all' }, dom.doc);
  const buttons = box.all().filter((e) => e.tag === 'button' && e.attrs['data-period']);
  assert.deepEqual(buttons.map((b) => b.textContent), ['I dag', 'Denne uken', 'Denne måneden', 'Hittil i år', 'Siste 12 måneder', 'Alt']);
  assert.ok(buttons.every((b) => b.type === 'button'));
  assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'false', 'false', 'false', 'true']);
  const group = box.all().find((e) => e.attrs.role === 'group' && e.children.includes(buttons[0]));
  assert.ok(group.attrs['aria-labelledby']);
  assert.equal(box.all().filter((e) => e.attrs['data-section'] === 'period').length, 1, 'the choice replaces the «Period» card');
  const tileOf = (title) => box.all().find((e) => e.className === 'stats-tile-value' && box.all().some((x) => x.children.includes(e) && x.children[1]?.textContent === title))?.textContent;
  assert.equal(tileOf(t.stats.newPlans), '5');
  buttons[0].click();
  assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['true', 'false', 'false', 'false', 'false', 'false']);
  assert.equal(tileOf(t.stats.newPlans), '2', 'every card follows the choice');
  const range = box.all().find((e) => e.attrs['aria-live'] === 'polite');
  assert.equal(range.textContent, '27. okt. 2026 – 27. okt. 2026');
  assert.ok(box.all().find((e) => e.attrs['aria-live'] === 'off'), 'the sections are not read out on every change');
  page.choose('all');
  assert.equal(buttons[5].attrs['aria-pressed'], 'true');
  assert.match(read('scripts/front-page.mjs'), /m\.mountStats\(box, j\.data, t, lang/);
});

test('(26.10) Channel under «Features in use»: events per channel follow the period, installations cover the usage period, the test toggle is explained', () => {
  const channels = { from: '2026-10-25', installs: { production: 5, preview: 2, unknown: 1 }, byDay: { '2026-10-25': { preview: 60 }, '2026-10-26': { production: 7, unknown: 2 }, '2026-10-27': { production: 3, preview: 4 } } };
  const t = textsFor('nb');
  const data = summary({ ...SAMPLE, channels, includesTest: true });
  assert.deepEqual(data.channels, channels, 'lib/stats.js keeps the block (numbers under short names only)');
  const view = statsView(data, t, 'nb', NAMES.nb);
  const ids = view.map((s) => s.id);
  assert.equal(ids.indexOf('channels'), ids.indexOf('events') + 1, 'right under «Funksjoner i bruk»');
  const ch = byId(view).channels;
  assert.equal(ch.title, 'Kanal');
  assert.deepEqual(ch.groups[0].rows.map((r) => [r.label, r.value]), [['Preview', '64'], ['Production', '10'], ['Ukjent kanal', '2']], '«all»: every day');
  assert.deepEqual(ch.groups[1].rows.map((r) => [r.label, r.value]), [['Production', '5'], ['Preview', '2'], ['Ukjent kanal', '1']]);
  assert.ok(ch.groups[1].notes[0].startsWith('Gjelder'), 'installations say which days they cover');
  assert.deepEqual(ch.notes, [t.stats.channelsWithTest]);
  // A period: only its days (today = 2026-10-27).
  const today = byId(statsView(data, t, 'nb', NAMES.nb, { period: 'today', today: '2026-10-27' })).channels;
  assert.deepEqual(today.groups[0].rows.map((r) => [r.label, r.value]), [['Preview', '4'], ['Production', '3']]);
  // Without test traffic the server sends only production; the card says why and names the switch.
  const off = byId(statsView(summary({ ...SAMPLE, channels: { from: '2026-10-25', installs: { production: 5 }, byDay: { '2026-10-26': { production: 7 } } } }), t, 'nb', NAMES.nb)).channels;
  assert.deepEqual(off.groups[0].rows.map((r) => r.label), ['Production']);
  assert.ok(off.notes[0].includes(`«${t.includeTest}»`) && off.notes[0].includes('bare production'), off.notes[0]);
  // A day without events in the period: «No data in the chosen period».
  const week = byId(statsView(summary({ ...SAMPLE, channels: { from: '2026-10-25', installs: {}, byDay: { '2026-10-01': { production: 1 } } } }), t, 'nb', NAMES.nb, { period: 'today', today: '2026-10-27' })).channels;
  assert.equal(week.groups[0].empty, t.stats.noDataInPeriod);
  // Nothing personal passes the server filter: no e-mail as a channel, no text values.
  assert.doesNotMatch(JSON.stringify(summary({ ...SAMPLE, channels: { installs: { 'a@b.c': 1, production: 'x' }, byDay: { '2026-10-26': { 'a@b.c': 2 } } } }).channels), /@|"x"/);
  // Every language: texts and placeholders filled, the channel names and both notes there.
  for (const l of CORE_LANGUAGES) {
    const tl = textsFor(l.code);
    const c = channelsSection(data, tl.stats, { number: String, date: String }, { from: null, to: '2026-10-27' }, tl);
    assert.ok(!/%\w+%|undefined|\[object/.test(JSON.stringify(c)), `${l.code}: filled`);
    for (const k of ['production', 'preview', 'development', 'dev', 'unknown']) assert.ok(tl.stats.channelNames[k], `${l.code} ${k}`);
    const offNote = channelsSection({ ...data, includesTest: false }, tl.stats, { number: String, date: String }, { from: null, to: '2026-10-27' }, tl).notes[0];
    assert.ok(offNote.includes(tl.includeTest), `${l.code}: the note names the switch`);
  }
});

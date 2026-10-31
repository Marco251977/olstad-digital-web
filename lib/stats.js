// The apps' statistics for /admin/<app>, fetched on the server only (api/admin.js, action «stats»).
// An app gets statistics by naming a source in data/apps.json (home.stats.source); a new source = one entry in SOURCES.
//
// PlanTravel (source «plantravel»): GET <PLANTRAVEL_API_URL>/stats/summary?includeTest=0|1, format in the PlanTravel repo
//   docs/stats-summary.md: period, active, retention, onboarding, events, platforms, versions, languages, providerClicks,
//   consent, db, stores (+ stores.note), channels (26.10: installations and events per channel), includesTest.
// Saldo Pocket (source «saldo»): GET <SALDO_STATS_URL>?includeTest=0|1 (the Edge Function stats-summary), format in the
//   Saldo repo docs/store-stats.md: period, stores (+ note), revenue (+ note, EUR). Its «usage» block is not kept: it is
//   always null (Saldo's USAGE_STATS is off and stats-summary has no usage summary – no source, 25.10). The revenue is
//   also given in NOK «ca.» with the exchange-rate service Saldo uses (the Edge Function exchange-rates next to
//   stats-summary, { base: 'EUR', rates: { NOK }, date }), converted here on the server; no rate = said so, never 0.
//
// Both: «Authorization: Bearer <key>». The keys live only in the server's environment (Vercel) – never sent to the
// browser – and the answer is never passed on as it is: summary() keeps only the known blocks, and inside them only
// numbers, null, booleans and short codes/dates under known names (no arrays, no free text, no «@»), so a field the
// endpoint adds later – or anything personal by mistake – never reaches the page. A missing value stays null (the page
// says «No data yet»), never 0.

/** Per source: setting names (names only – the page says which are missing), the request URL and the blocks kept. */
export const SOURCES = {
  plantravel: {
    url: 'PLANTRAVEL_API_URL',
    key: 'PLANTRAVEL_STATS_KEY',
    request: (base, includeTest) => `${base}/stats/summary?includeTest=${includeTest ? 1 : 0}`,
    blocks: ['period', 'active', 'activeWeb', 'retention', 'onboarding', 'events', 'platforms', 'versions', 'languages', 'providerClicks', 'consent', 'db', 'stores', 'channels', 'includesTest'],
  },
  saldo: {
    url: 'SALDO_STATS_URL',
    key: 'SALDO_STATS_KEY',
    // The whole function URL (…/functions/v1/stats-summary); includeTest changes nothing there (store numbers have no test mark).
    request: (base, includeTest) => `${base}?includeTest=${includeTest ? 1 : 0}`,
    blocks: ['period', 'stores', 'revenue', 'includesTest'],
    // The revenue in NOK «ca.» (Saldo's own exchange-rate service, same Supabase project as stats-summary; the project's
    // public key SUPABASE_ANON_KEY is the one /admin's sign-in already uses).
    convert: { to: 'NOK', ratesUrl: (base) => base.replace(/\/stats-summary$/, '/exchange-rates'), anonKey: 'SUPABASE_ANON_KEY' },
  },
};

const TIMEOUT_MS = 10_000;
const MAX_ENTRIES = 1000;
const MAX_DEPTH = 6;
// A key: letters, digits and a few separators, at most 64 – never an e-mail address (no «@») or free text.
const KEY = /^[\p{L}\p{N}_.:+\- ]{1,64}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
// A code (reason, note, basis, currency): letters, digits and _ : , – never a sentence.
const CODE = /^[A-Za-z0-9_:,]{1,200}$/;
// The only fields that may carry a string, and what it may look like.
const DATE_FIELDS = new Set(['from', 'to', 'firstDate', 'fetchedAt', 'asOf', 'date']);
const CODE_FIELDS = new Set(['reason', 'note', 'basis', 'currency']);
// Maps whose keys are names (an event, a day, a country …): their values are only numbers or objects, never strings.
const NAME_MAPS = new Set(['events', 'platforms', 'versions', 'languages', 'byDay', 'byWeek', 'byMonth', 'days', 'countries', 'byProvider', 'byType', 'byPlatform', 'current', 'installs', 'bySource']);
// (30.10) providerClicks.names: supplier id → the supplier's BRAND name (Booking.com, Hotels.com …, from the app's one
// list, docs/stats-summary.md). The only map whose values may be text: a short brand name, never a sentence or an e-mail.
const SUPPLIER_NAME = /^[\p{L}\p{N} ./+&'’-]{1,40}$/u;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A number, or null for anything else (missing, text, NaN …). */
export const count = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * One value cleaned: numbers, null and booleans as they are; strings only in the known fields (dates, codes) or inside a
 * «reasons» map (metric → code); objects with allowed keys, recursively (depth and size limited); everything else dropped.
 */
function clean(value, field, depth, inReasons = false, inNameMap = false, inSupplierNames = false) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (inSupplierNames) return SUPPLIER_NAME.test(value) ? value : undefined;
    if (inNameMap) return undefined;
    if (DATE_FIELDS.has(field)) return ISO_DATE.test(value) ? value : null;
    if (CODE_FIELDS.has(field) || inReasons) return CODE.test(value) ? value : null;
    return undefined;
  }
  if (!isObject(value) || depth > MAX_DEPTH) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(value).slice(0, MAX_ENTRIES)) {
    if (!KEY.test(k)) continue;
    const c = clean(v, k, depth + 1, field === 'reasons', NAME_MAPS.has(field), field === 'names' && depth === 1);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

/** The answer reduced to the source's known blocks of aggregate numbers; a block that is missing or not an object is null. */
export function summary(raw, source = 'plantravel') {
  const r = isObject(raw) ? raw : {};
  const out = {};
  for (const block of SOURCES[source].blocks) {
    if (block === 'includesTest') out.includesTest = typeof r.includesTest === 'boolean' ? r.includesTest : null;
    else {
      const c = clean(r[block], block, 0);
      out[block] = isObject(c) ? c : null;
    }
  }
  return out;
}

/** A number in the target currency, rounded to 2 decimals; null stays null. */
const convertAmount = (v, rate) => (count(v) === null || count(rate) === null ? null : Math.round(v * rate * 100) / 100);
const AMOUNT_METRICS = new Set(['mrr', 'revenue']);

/** The money metrics of every row in a { name: { metric: value } } map, converted; counts are left out. */
function convertRows(rows, rate) {
  if (!isObject(rows)) return null;
  const out = {};
  for (const [k, v] of Object.entries(rows)) {
    if (!isObject(v)) continue;
    const row = {};
    for (const [m, n] of Object.entries(v)) if (AMOUNT_METRICS.has(m)) row[m] = convertAmount(n, rate);
    out[k] = row;
  }
  return out;
}

/**
 * revenue.converted: { currency: 'NOK', rate, date, stale, current, days } with every amount (mrr, revenue) in NOK, or
 * { currency, rate: null, reason } when there is no rate (rate_missing / rates_unavailable / no_currency). Pure.
 */
export function convertRevenue(revenue, rates, to) {
  if (!isObject(revenue)) return null;
  const from = typeof revenue.currency === 'string' ? revenue.currency : null;
  if (!from) return { currency: to, rate: null, reason: 'no_currency' };
  if (!isObject(rates) || !isObject(rates.rates)) return { currency: to, rate: null, reason: 'rates_unavailable' };
  // The service gives rates from its base (EUR): rate(from → to) = rates[to] / rates[from] (rates[base] = 1).
  const rateOf = (c) => (c === rates.base ? 1 : count(rates.rates[c]));
  const toRate = rateOf(to);
  const fromRate = rateOf(from);
  if (toRate === null || fromRate === null || fromRate === 0) return { currency: to, rate: null, reason: 'rate_missing' };
  const rate = toRate / fromRate;
  const current = {};
  for (const [plan, platforms] of Object.entries(isObject(revenue.current) ? revenue.current : {})) current[plan] = convertRows(platforms, rate);
  return {
    currency: to,
    rate: Math.round(rate * 10000) / 10000,
    date: typeof rates.date === 'string' && ISO_DATE.test(rates.date) ? rates.date : null,
    stale: rates.stale === true,
    current,
    days: convertRows(revenue.days, rate),
  };
}

/** The exchange rates from the service, or null (any failure – the page then says the rate is missing). Never throws. */
async function fetchRates(url, anonKey, fetcher) {
  try {
    const r = await fetcher(url, {
      headers: { accept: 'application/json', ...(anonKey ? { apikey: anonKey, authorization: `Bearer ${anonKey}` } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      console.error(`admin stats rates: ${r.status}`);
      return null;
    }
    const j = await r.json();
    return isObject(j) && j.ok !== false && isObject(j.rates) ? j : null;
  } catch (error) {
    console.error(`admin stats rates: ${error?.name ?? 'error'}`);
    return null;
  }
}

/**
 * Fetches an app's statistics. Returns { status, body } for api/admin.js: 200 { data }, or an error code the page has a
 * text for – stats_not_configured (503, with the missing names), source_refused (502: the app's server said no to the
 * key), source (502, with the app server's status / bad_json), source_timeout (504).
 */
export async function fetchStats(source, { includeTest = false } = {}, env = process.env, fetcher = fetch) {
  const def = SOURCES[source];
  if (!def) return { status: 503, body: { error: 'stats_not_configured', missing: [String(source)] } };
  const base = String(env[def.url] ?? '').trim().replace(/\/$/, '');
  const key = String(env[def.key] ?? '').trim();
  const missing = [!base && def.url, !key && def.key].filter(Boolean);
  if (missing.length) {
    console.error(`admin stats ${source}: not configured, missing ${missing.join(', ')}`);
    return { status: 503, body: { error: 'stats_not_configured', missing } };
  }
  let r;
  try {
    r = await fetcher(def.request(base, includeTest), {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`admin stats ${source}: ${error?.name ?? 'error'}`);
    return { status: 504, body: { error: 'source_timeout', code: error?.name === 'TimeoutError' ? 'timeout' : 'network' } };
  }
  if (r.status === 401 || r.status === 403) {
    console.error(`admin stats ${source}: refused ${r.status}`);
    return { status: 502, body: { error: 'source_refused', code: String(r.status) } };
  }
  if (!r.ok) {
    console.error(`admin stats ${source}: ${r.status}`);
    return { status: 502, body: { error: 'source', code: String(r.status) } };
  }
  let raw;
  try { raw = await r.json(); } catch { return { status: 502, body: { error: 'source', code: 'bad_json' } }; }
  const data = summary(raw, source);
  if (def.convert && data.revenue) {
    const rates = await fetchRates(def.convert.ratesUrl(base), String(env[def.convert.anonKey] ?? '').trim(), fetcher);
    data.revenue.converted = convertRevenue(data.revenue, rates, def.convert.to);
  }
  return { status: 200, body: { data } };
}

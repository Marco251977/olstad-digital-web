// The apps' statistics for /admin/<app>, fetched on the server only (api/admin.js, action «stats»).
// An app gets statistics by naming a source in data/apps.json (home.stats.source); today only PlanTravel has one.
//
// PlanTravel: GET <PLANTRAVEL_API_URL>/stats/summary?includeTest=0|1 with the header
// «Authorization: Bearer <PLANTRAVEL_STATS_KEY>». The key lives only in the server's environment (Vercel) – it is never
// sent to the browser, and the answer is never passed on as it is: only aggregate numbers are kept (summary(), below),
// so a field the endpoint adds later – or anything personal by mistake – never reaches the page.
//
// The format we expect (see the report / PlanTravel docs/stats-summary.md when it exists):
//   { period: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', days?: n } | 'text',
//     active: { day, week, month },                    // counts
//     retention: { day1: 0.42, day7: 0.2, … },          // shares 0–1 (a value over 1 is read as per cent)
//     onboarding: { started, completed, skipped, … },   // counts
//     events: { <eventId>: count }, providerClicks: { <supplier>: count },
//     platforms: { ios: n, android: n }, versions: { '1.2.3': n }, languages: { nb: n },
//     legacy: { <name>: count | { <id>: count } },      // the old numbers, from before the new statistics
//     includesTest: boolean }
// A missing or non-numeric value becomes null (the page shows «–», never 0).

/** Setting names per source (names only – the page says which are missing). */
export const SOURCES = {
  plantravel: { url: 'PLANTRAVEL_API_URL', key: 'PLANTRAVEL_STATS_KEY' },
};

const TIMEOUT_MS = 10_000;
const MAX_ENTRIES = 200;
// A key in a count map: letters, digits and a few separators, at most 64 – never an e-mail address (no «@») or free text.
const KEY = /^[\p{L}\p{N}_.:+\- ]{1,64}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A number, or null for anything else (missing, text, NaN …). */
export const count = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** { id: number } – only allowed keys with numbers; null when the value is not an object. */
function countMap(v) {
  if (!isObject(v)) return null;
  const out = {};
  for (const [k, n] of Object.entries(v).slice(0, MAX_ENTRIES)) if (KEY.test(k) && count(n) !== null) out[k] = n;
  return out;
}

/** Numbers and count maps one level down (retention, onboarding, legacy). */
function numbers(v) {
  if (!isObject(v)) return null;
  const out = {};
  for (const [k, n] of Object.entries(v).slice(0, MAX_ENTRIES)) {
    if (!KEY.test(k)) continue;
    if (count(n) !== null) out[k] = n;
    else if (isObject(n)) out[k] = countMap(n);
  }
  return out;
}

function period(v) {
  if (typeof v === 'string') return v.length <= 64 ? v : null;
  if (!isObject(v)) return null;
  const date = (d) => (typeof d === 'string' && ISO_DATE.test(d) ? d : null);
  return { from: date(v.from), to: date(v.to), days: count(v.days) };
}

/** The answer reduced to aggregate numbers in a fixed shape; everything else is dropped. */
export function summary(raw) {
  const r = isObject(raw) ? raw : {};
  const active = isObject(r.active) ? r.active : {};
  return {
    period: period(r.period),
    active: { day: count(active.day), week: count(active.week), month: count(active.month) },
    retention: numbers(r.retention),
    onboarding: numbers(r.onboarding),
    events: countMap(r.events),
    providerClicks: countMap(r.providerClicks),
    platforms: countMap(r.platforms),
    versions: countMap(r.versions),
    languages: countMap(r.languages),
    legacy: numbers(r.legacy),
    includesTest: typeof r.includesTest === 'boolean' ? r.includesTest : null,
  };
}

/**
 * Fetches an app's statistics. Returns { status, body } for api/admin.js: 200 { data }, or an error code the page has a
 * text for – stats_not_configured (503, with the missing names), source_refused (502: the app's server said no to the
 * key), source (502, with the app server's status / bad_json), source_timeout (504).
 */
export async function fetchStats(source, { includeTest = false } = {}, env = process.env, fetcher = fetch) {
  const names = SOURCES[source];
  const base = String(env[names.url] ?? '').trim().replace(/\/$/, '');
  const key = String(env[names.key] ?? '').trim();
  const missing = [!base && names.url, !key && names.key].filter(Boolean);
  if (missing.length) {
    console.error(`admin stats ${source}: not configured, missing ${missing.join(', ')}`);
    return { status: 503, body: { error: 'stats_not_configured', missing } };
  }
  let r;
  try {
    r = await fetcher(`${base}/stats/summary?includeTest=${includeTest ? 1 : 0}`, {
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
  return { status: 200, body: { data: summary(raw) } };
}

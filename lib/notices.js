// /admin/<app> «Abonnementsvarsel» (Saldo Pocket, 04.11): the proof log of the half-yearly «your subscription is running»
// notice (digitalytelsesloven § 33), read on the server only – the same pattern as lib/stats.js.
//
// An app gets the section by naming a source in data/apps.json (home.notices.source). Saldo (source «saldo»): the Edge
// Function subscription-notice-admin next to stats-summary (same Supabase project, same key SALDO_STATS_KEY, «Authorization:
// Bearer <key>»):
//   GET …/subscription-notice-admin?purchase=<purchase id>&test=0|1 → { ok, rows: [{ due_on, notice_kind, channel,
//       shown_at_utc, shown_tz, dismissed_at, manage_tapped_at, email_sent_at, resend_id, plan, store, product,
//       price_minor, currency, price_missing, text_version, text_hash, test_traffic, retain_until, created_at }] } (newest first)
//   GET …?view=months&test=0|1 → { ok, months: [{ month: 'YYYY-MM', channel, sent, shown, dismissed }] }
//   Errors 401 unauthorized / 400 bad_request / 500 server; a function that is not deployed yet = 404 from Supabase.
//
// The key never leaves the server, and the answer is never passed on as it is: only the known fields, each checked
// against what it may look like (dates, short codes, numbers, booleans) – a field the function adds later, or anything
// personal by mistake, never reaches the page. Read only: the page can never change the log.

/** Per source: the setting names (the page says which are missing) and the function's URL. */
export const NOTICE_SOURCES = {
  saldo: {
    url: 'SALDO_STATS_URL',
    key: 'SALDO_STATS_KEY',
    // SALDO_STATS_URL is the whole stats-summary URL (…/functions/v1/stats-summary); the admin function is next to it.
    endpoint: (base) => base.replace(/\/[^/]+$/, '/subscription-notice-admin'),
  },
};

const TIMEOUT_MS = 10_000;
const MAX_ROWS = 500;
const MAX_MONTHS = 600;
/** A purchase id as the stores write it (App Store: digits; Google Play: «GPA.1234-5678-9012-34567»; RevenueCat ids). */
export const PURCHASE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;
const CODE = /^[A-Za-z0-9_.:-]{1,100}$/;
const TZ = /^[A-Za-z0-9_+\-/]{1,64}$/;
const CURRENCY = /^[A-Z]{3}$/;
const HASH = /^[A-Za-z0-9_:+/=-]{1,128}$/;
const MONTH = /^\d{4}-\d{2}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (re) => (v) => (typeof v === 'string' && re.test(v) ? v : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v) => (typeof v === 'boolean' ? v : null);

/** The fields of one log row and how each is checked. Anything else is dropped. */
const ROW_FIELDS = {
  due_on: str(ISO_DATE),
  notice_kind: str(CODE),
  channel: str(CODE),
  shown_at_utc: str(ISO_TIME),
  shown_tz: str(TZ),
  dismissed_at: str(ISO_TIME),
  manage_tapped_at: str(ISO_TIME),
  email_sent_at: str(ISO_TIME),
  resend_id: str(CODE),
  plan: str(CODE),
  store: str(CODE),
  product: str(CODE),
  price_minor: num,
  currency: str(CURRENCY),
  price_missing: bool,
  text_version: str(CODE),
  text_hash: str(HASH),
  test_traffic: bool,
  retain_until: str(ISO_DATE),
  created_at: str(ISO_TIME),
};

/** One row reduced to the known fields (a field that is missing or does not look right = null). */
export function noticeRow(raw) {
  const r = isObject(raw) ? raw : {};
  return Object.fromEntries(Object.entries(ROW_FIELDS).map(([k, check]) => [k, check(r[k])]));
}

/** One month line reduced: month, channel and the three counts (a count that is not a number = null, never 0). */
export function monthRow(raw) {
  const r = isObject(raw) ? raw : {};
  return { month: str(MONTH)(r.month), channel: str(CODE)(r.channel), sent: num(r.sent), shown: num(r.shown), dismissed: num(r.dismissed) };
}

/**
 * Reads the log. Returns { status, body } for api/admin.js: 200 { rows } or { months }, or an error code the page has a
 * text for – notices_not_configured (503, with the missing names), notices_missing (503: the function or the table does
 * not exist yet – Supabase answers 404), source_refused (502), source (502, with the status), source_timeout (504),
 * bad_request (400: the purchase id does not look like one).
 */
export async function fetchNotices(source, { view = 'purchase', purchase = '', includeTest = false } = {}, env = process.env, fetcher = fetch) {
  const def = NOTICE_SOURCES[source];
  if (!def) return { status: 503, body: { error: 'notices_not_configured', missing: [String(source)] } };
  const id = String(purchase ?? '').trim();
  if (view !== 'months' && !PURCHASE_ID.test(id)) return { status: 400, body: { error: 'bad_request' } };
  const base = String(env[def.url] ?? '').trim().replace(/\/$/, '');
  const key = String(env[def.key] ?? '').trim();
  const missing = [!base && def.url, !key && def.key].filter(Boolean);
  if (missing.length) {
    console.error(`admin notices ${source}: not configured, missing ${missing.join(', ')}`);
    return { status: 503, body: { error: 'notices_not_configured', missing } };
  }
  const query = view === 'months' ? `view=months&test=${includeTest ? 1 : 0}` : `purchase=${encodeURIComponent(id)}&test=${includeTest ? 1 : 0}`;
  let r;
  try {
    r = await fetcher(`${def.endpoint(base)}?${query}`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`admin notices ${source}: ${error?.name ?? 'error'}`);
    return { status: 504, body: { error: 'source_timeout', code: error?.name === 'TimeoutError' ? 'timeout' : 'network' } };
  }
  // Never the purchase id in the log – only the view and the status.
  if (r.status === 404) {
    console.error(`admin notices ${source} ${view}: 404 (function not deployed yet)`);
    return { status: 503, body: { error: 'notices_missing' } };
  }
  if (r.status === 401 || r.status === 403) {
    console.error(`admin notices ${source} ${view}: refused ${r.status}`);
    return { status: 502, body: { error: 'source_refused', code: String(r.status) } };
  }
  if (r.status === 400) return { status: 400, body: { error: 'bad_request' } };
  let raw;
  try { raw = await r.json(); } catch { raw = null; }
  if (!r.ok || !isObject(raw) || raw.ok !== true) {
    // The function answers 500 { error: 'server' } also when its table is missing (relation does not exist).
    const code = isObject(raw) && typeof raw.error === 'string' && CODE.test(raw.error) ? raw.error : r.ok ? 'bad_json' : String(r.status);
    console.error(`admin notices ${source} ${view}: ${r.status} ${code}`);
    return { status: 502, body: { error: 'source', code } };
  }
  if (view === 'months') {
    const months = (Array.isArray(raw.months) ? raw.months : []).slice(0, MAX_MONTHS).map(monthRow).filter((m) => m.month);
    return { status: 200, body: { months } };
  }
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).slice(0, MAX_ROWS).map(noticeRow);
  return { status: 200, body: { rows } };
}

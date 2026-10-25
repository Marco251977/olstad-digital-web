// /admin/<app>: ONE page for every app's statistics. The server sends the app's summary (api/admin.js → lib/stats.js,
// already reduced to aggregate numbers); statsView() turns it into sections and renderStats() writes them. Which sections
// appear depends only on what the summary contains (a block the source does not have = no section), so a new app gets
// the same page by naming its source in data/apps.json (home.stats.source).
//
// statsView() is plain data (tested in test/admin-stats.test.mjs); renderStats() writes it with textContent only –
// nothing from the server is ever read as HTML. Texts: t.stats from i18n/home/<lang>.json (admin.stats), placeholders as
// %name%. Numbers, money, shares, dates, languages and countries via Intl in the page's language.
// A value that is missing (null) is «No data yet» (t.stats.noDataYet) – in a table cell «–» with the legend under it –
// and never 0; a real 0 is 0.
//
// The period (Marco 25.10): ONE choice at the top (mountStats) – today, this week, this month, so far this year, the
// last 12 months, all (default) – for every card. Only numbers that come per day can follow it: they are filtered here,
// in the browser, from the per-day series the servers send (how the servers count is never changed). A number a server
// sends only as a total (active users, retention, events …, countries, consent per platform) or as a state now (active
// plans, subscriptions) cannot follow it: its card says which days it covers, whatever period is chosen. A card whose
// data starts later than the period says «From <date>». Long tables and lists show 10 rows, then «Show 10 more».

export const MISSING = '–';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const fillText = (template, vars) => String(template ?? '').replace(/%(\w+)%/g, (m, k) => (k in vars ? vars[k] : m));
const entries = (v) => (isObject(v) ? Object.entries(v) : []);

/** Store metrics in the shared order (PlanTravel and Saldo: store_stats_daily). active_devices is a level, not a sum. */
export const STORE_METRICS = ['downloads', 'redownloads', 'uninstalls', 'active_devices', 'page_views', 'store_acquisitions', 'crashes', 'anrs'];
const LEVEL_METRICS = new Set(['active_devices']);
const COUNTRY_METRICS = ['downloads', 'uninstalls', 'page_views'];
/** Rows shown at first in a long table or list, and how many more each «Show 10 more» adds. */
export const PAGE = 10;
/** The period choices, in the order shown; «all» is the default. */
export const PERIODS = ['today', 'week', 'month', 'year', 'last12', 'all'];
export const DEFAULT_PERIOD = 'all';
/** Store reasons that only say a metric does not exist on that platform: it can never get data, so it is not listed. */
const NEVER_REASONS = new Set(['not_on_ios', 'not_on_android']);

export function formatters(lang) {
  const number = new Intl.NumberFormat(lang);
  const share = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' });
  const dateTime = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  const month = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const rate = new Intl.NumberFormat(lang, { maximumFractionDigits: 4 });
  let languages = null;
  let regions = null;
  try { languages = new Intl.DisplayNames([lang], { type: 'language' }); } catch (e) {}
  try { regions = new Intl.DisplayNames([lang], { type: 'region' }); } catch (e) {}
  const toDate = (v) => {
    const d = typeof v === 'string' ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  return {
    number: (v) => (isNumber(v) ? number.format(v) : MISSING),
    rate: (v) => (isNumber(v) ? rate.format(v) : MISSING),
    // A share is 0–1; a value over 1 is read as per cent.
    share: (v) => (isNumber(v) ? share.format(v > 1 ? v / 100 : v) : MISSING),
    money: (v, currency) => {
      if (!isNumber(v)) return MISSING;
      try { return new Intl.NumberFormat(lang, { style: 'currency', currency, maximumFractionDigits: 2 }).format(v); } catch (e) { return `${number.format(v)} ${currency}`; }
    },
    date: (v) => (toDate(v) ? date.format(toDate(v)) : MISSING),
    dateTime: (v) => (toDate(v) ? (v.length === 10 ? date.format(toDate(v)) : dateTime.format(toDate(v))) : MISSING),
    month: (key) => (toDate(`${key}-01`) ? month.format(toDate(`${key}-01`)) : key),
    language: (code) => {
      try { return (languages && languages.of(code)) || code; } catch (e) { return code; }
    },
    country: (code) => {
      try { return (regions && regions.of(code)) || code; } catch (e) { return code; }
    },
  };
}

/** «2026-10-25» → «2026-W43» (ISO week, as the servers write it). */
export function isoWeek(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // the week's Thursday decides its year
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3); // Thursday of week 1
  const week = 1 + Math.round((d - jan4) / (7 * 86400000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Days { day: { metric: n | null } } summed per week or month (when the source does not send byWeek/byMonth itself):
 * the sum of the days that have a number; null when no day in it has one; a level metric (active devices) = the last known.
 */
export function aggregate(days, unit, levels = LEVEL_METRICS) {
  const out = {};
  for (const [day, row] of entries(days).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!isObject(row)) continue;
    const key = unit === 'week' ? isoWeek(day) : day.slice(0, 7);
    const into = (out[key] ??= {});
    for (const [m, v] of Object.entries(row)) {
      if (!(m in into)) into[m] = null;
      if (!isNumber(v)) continue;
      into[m] = levels.has(m) ? v : (into[m] ?? 0) + v;
    }
  }
  return out;
}

// ---- The period ----

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Today as the servers count it (UTC day). */
export const utcToday = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * The days a period covers, ending on `today` (a UTC day «YYYY-MM-DD», as the servers write their days): { from, to },
 * from null for «all». The week starts on Monday (ISO, as the servers' weeks); «last12» = the 12 months up to and
 * including today (from the day after the same date a year earlier).
 */
export function periodRange(period, today) {
  const to = ISO_DAY.test(String(today)) ? today : utcToday();
  const d = new Date(`${to}T00:00:00Z`);
  switch (period) {
    case 'today': return { from: to, to };
    case 'week': return { from: addDays(to, -((d.getUTCDay() + 6) % 7)), to };
    case 'month': return { from: `${to.slice(0, 7)}-01`, to };
    case 'year': return { from: `${to.slice(0, 4)}-01-01`, to };
    case 'last12': {
      // The same date a year earlier (29 Feb → 28 Feb), and the day after it.
      const y = d.getUTCFullYear() - 1;
      const m = d.getUTCMonth();
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const before = new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))).toISOString().slice(0, 10);
      return { from: addDays(before, 1), to };
    }
    default: return { from: null, to };
  }
}

/** A { day: value } map with only the days in the range (every day for «all»); not a map → null. */
export function filterDays(map, range) {
  if (!isObject(map)) return null;
  if (!range || !range.from) return map;
  return Object.fromEntries(Object.entries(map).filter(([k]) => k >= range.from && k <= range.to));
}

/** The sum of the numbers in a map or list; null when none is a number (never 0 for «nothing known»). */
export function sumOf(values) {
  let total = null;
  for (const v of Array.isArray(values) ? values : Object.values(isObject(values) ? values : {})) if (isNumber(v)) total = (total ?? 0) + v;
  return total;
}

/** The first day that is a key in any of the maps (or null). */
const firstKey = (...maps) => maps.flatMap((m) => (isObject(m) ? Object.keys(m) : [])).filter((k) => ISO_DAY.test(k)).sort()[0] ?? null;

/** { day: n } (one number per day) summed per ISO week or month. */
function aggregateScalar(byDay, unit) {
  const rows = aggregate(Object.fromEntries(entries(byDay).map(([k, v]) => [k, { v }])), unit, new Set());
  return Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r.v]));
}

/**
 * A { firstDate, total, byDay, byWeek, byMonth } block for the chosen period: «all» = as the server sent it; otherwise
 * the days in the period, their sum as the total, and weeks/months summed from those days. No byDay = the total cannot
 * follow the period (null – never the server's total for another period).
 */
export function blockIn(block, range) {
  if (!isObject(block) || !range || !range.from) return block;
  if (!isObject(block.byDay)) return { ...block, total: null, byDay: null, byWeek: null, byMonth: null };
  const byDay = filterDays(block.byDay, range);
  return { ...block, total: sumOf(byDay), byDay, byWeek: aggregateScalar(byDay, 'week'), byMonth: aggregateScalar(byDay, 'month') };
}

/** «From <date>» when the data starts later than the period (always for «all»); otherwise nothing. */
function startNote(firstDate, range, s, f) {
  if (!firstDate) return null;
  if (range && range.from && firstDate <= range.from) return null;
  return fillText(s.since, { date: f.date(firstDate) });
}

/** A number as a single value: the number (0 is 0), or «No data yet». */
const valueOf = (v, f, s) => (isNumber(v) ? f.number(v) : s.noDataYet);

/** A reason code (or Saldo's «source:code,source:code») as text; an unknown code is shown in the «other» text. */
export function reasonText(code, s) {
  if (typeof code !== 'string' || !code) return null;
  return code
    .split(',')
    .map((part) => {
      const [source, reason] = part.includes(':') ? part.split(':') : [null, part];
      const text = s.reasons?.[reason] ?? fillText(s.reasons?.other, { code: reason });
      return source ? `${s.sourceNames?.[source] ?? source}: ${text}` : text;
    })
    .join(' · ');
}

/** day1 / day7 / month1 → «Day 1», «Month 1» …; anything else: the key. */
function retentionLabel(key, s) {
  const m = /^(d|day|w|week|m|month)[_-]?(\d+)$/i.exec(key);
  if (!m) return key;
  const unit = m[1][0].toLowerCase();
  return fillText(s[unit === 'd' ? 'dayN' : unit === 'w' ? 'weekN' : 'monthN'], { n: m[2] });
}

/** A count map as rows, largest first, with a bar (share of the largest); null / empty → no rows. */
function mapRows(map, label, f) {
  const rows = entries(map)
    .filter(([, v]) => isNumber(v))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const max = Math.max(0, ...rows.map(([, v]) => v));
  return rows.map(([k, v]) => ({ label: label(k), value: f.number(v), bar: max > 0 ? v / max : 0 }));
}

/** A label for a series key: day, ISO week or month. */
function seriesLabel(key, unit, f, s) {
  if (unit === 'day') return f.date(key);
  if (unit === 'week') {
    const m = /^(\d{4})-W(\d{2})$/.exec(key);
    return m ? fillText(s.weekOfYear, { n: String(Number(m[2])), year: m[1] }) : key;
  }
  return f.month(key);
}

/**
 * A time series as { columns, legend, views: { day, week, month } } – each view a list of rows (newest first) with the
 * cells already formatted; the first column also gets a bar. columns = [{ id, label, format(v) }]; byUnit(unit) gives the
 * { key: { columnId: value } } map for that unit (null when the unit is not available). Every row is in the view; the
 * page shows 10 at a time.
 */
function series(columns, byUnit, f, s) {
  const views = {};
  for (const unit of ['day', 'week', 'month']) {
    const map = byUnit(unit);
    if (!isObject(map) || !Object.keys(map).length) continue;
    const keys = Object.keys(map).sort().reverse();
    const first = columns[0].id;
    const max = Math.max(0, ...keys.map((k) => (isNumber(map[k]?.[first]) ? map[k][first] : 0)));
    views[unit] = keys.map((k) => ({
      label: seriesLabel(k, unit, f, s),
      cells: columns.map((c) => c.format(map[k]?.[c.id])),
      bar: isNumber(map[k]?.[first]) && max > 0 ? map[k][first] / max : 0,
    }));
  }
  return Object.keys(views).length ? { columns: columns.map((c) => c.label), legend: s.noDataLegend, views } : null;
}

/** Several { byDay, byWeek, byMonth } blocks (one per column) joined into { key: { column: n } } per unit. */
function joinBlocks(blocks) {
  return (unit) => {
    const prop = unit === 'day' ? 'byDay' : unit === 'week' ? 'byWeek' : 'byMonth';
    const out = {};
    let any = false;
    for (const [col, block] of Object.entries(blocks)) {
      if (!isObject(block?.[prop])) continue;
      any = true;
      for (const [k, v] of Object.entries(block[prop])) (out[k] ??= {})[col] = v;
    }
    return any ? out : null;
  };
}

/** A note (a key from the summary) as text; an unknown note is shown as its code. */
const noteText = (code, s) => (typeof code === 'string' ? s.notes?.[code] ?? code : null);

/** «No data in the chosen period» when a series has days, but none in the period. */
const periodEmpty = (hadDays, view, range, s) => (!view && hadDays && range.from ? s.noDataInPeriod : null);

// ---- Sections ----

/** The period choice at the top: the choices, the days the period covers, and whether test traffic is in. */
export function periodBar(data, t, lang, period = DEFAULT_PERIOD, today = null) {
  const s = t.stats;
  const f = formatters(lang);
  const d = isObject(data) ? data : {};
  const range = periodRange(period, today ?? d.period?.to);
  const first =
    range.from ??
    firstKey(
      d.db?.newAccounts?.byDay,
      d.db?.newPlans?.byDay,
      ...Object.values(isObject(d.providerClicks?.byType) ? d.providerClicks.byType : {}).map((b) => b?.byDay),
      d.consent?.byDay,
      d.stores?.ios?.days,
      d.stores?.android?.days,
      d.revenue?.days,
    );
  return {
    label: s.period,
    choices: PERIODS.map((id) => ({ id, label: s.periods?.[id] ?? id, pressed: id === period })),
    text: first ? fillText(s.periodRange, { from: f.date(first), to: f.date(range.to) }) : s.noDataYet,
    note: d.includesTest === true ? s.withTest : d.includesTest === false ? s.withoutTest : null,
  };
}

/** «Covers <from> – <to>, whatever period is chosen» for the totals over the server's usage period. */
const usageNote = (d, s, f) => (isObject(d.period) && d.period.from && d.period.to ? fillText(s.coversUsage, { from: f.date(d.period.from), to: f.date(d.period.to) }) : null);

function activeSection(d, s, f) {
  const a = isObject(d.active) ? d.active : {};
  return {
    id: 'active',
    title: s.active,
    note: d.period?.to ? fillText(s.coversActive, { date: f.date(d.period.to) }) : null,
    tiles: [['day', s.day], ['week', s.week], ['month', s.month]].map(([k, label]) => ({ label, value: valueOf(a[k], f, s) })),
  };
}

function dbSection(d, s, f, range) {
  const db = d.db;
  if (!isObject(db)) return { id: 'db', title: s.db, empty: s.noDataYet };
  const first = [db.newAccounts?.firstDate, db.newPlans?.firstDate].filter(Boolean).sort()[0];
  const accounts = blockIn(db.newAccounts, range);
  const plans = blockIn(db.newPlans, range);
  const view = series(
    [{ id: 'accounts', label: s.newAccounts, format: f.number }, { id: 'plans', label: s.newPlans, format: f.number }],
    joinBlocks({ accounts, plans }),
    f,
    s,
  );
  return {
    id: 'db',
    title: s.db,
    note: startNote(first, range, s, f),
    tiles: [
      { label: s.newAccounts, value: valueOf(accounts?.total, f, s) },
      { label: s.newPlans, value: valueOf(plans?.total, f, s) },
      { label: s.activePlans, value: valueOf(db.activePlans, f, s) },
    ],
    // Active plans are a state now: they cannot follow the period.
    notes: [isNumber(db.activePlans) && d.period?.to ? fillText(s.snapshot, { what: s.activePlans, date: f.date(d.period.to) }) : null],
    series: view,
    seriesEmpty: periodEmpty(Boolean(firstKey(db.newAccounts?.byDay, db.newPlans?.byDay)), view, range, s),
  };
}

function providerSection(d, s, f, names, range) {
  const pc = d.providerClicks;
  if (!isObject(pc)) return { id: 'providerClicks', title: s.providerClicks, empty: s.noDataYet };
  const typeName = (k) => names[`provider_click:${k}`] ?? k;
  const inRange = (map) => Object.fromEntries(entries(map).map(([k, b]) => [k, blockIn(b, range)]));
  const byType = inRange(pc.byType);
  const byProvider = inRange(pc.byProvider);
  const totals = (map) => Object.fromEntries(entries(map).map(([k, v]) => [k, v?.total]));
  const types = Object.keys(byType).sort();
  // The total per day/week/month = the sum of the types (every click has exactly one type).
  const total = { byDay: {}, byWeek: {}, byMonth: {} };
  for (const t of types) for (const prop of Object.keys(total)) for (const [k, v] of entries(byType[t]?.[prop])) if (isNumber(v)) total[prop][k] = (total[prop][k] ?? 0) + v;
  const view = types.length
    ? series([{ id: 'total', label: s.total, format: f.number }, ...types.map((t) => ({ id: t, label: typeName(t), format: f.number }))], joinBlocks({ total, ...byType }), f, s)
    : null;
  // «All» = the server's total; a period = the sum of the types in it (no types at all = 0 clicks, as the server says).
  const clicks = range.from ? (types.length ? sumOf(totals(byType)) : count0(pc.total)) : pc.total;
  return {
    id: 'providerClicks',
    title: s.providerClicks,
    note: startNote(pc.from, range, s, f),
    tiles: [{ label: s.total, value: valueOf(clicks, f, s) }],
    groups: [
      { title: s.byProvider, rows: mapRows(totals(byProvider), (k) => k, f), empty: s.noDataYet },
      { title: s.byType, rows: mapRows(totals(byType), typeName, f), empty: s.noDataYet },
    ],
    series: view,
    seriesEmpty: periodEmpty(types.some((t) => firstKey(pc.byType[t]?.byDay)), view, range, s),
  };
}
/** The server's 0 stays 0 for any period; any other total without days cannot follow a period. */
const count0 = (v) => (v === 0 ? 0 : null);

/** The consent numbers for the period: yes, no, answered and the share of yes = yes / answered (null without answers). */
export function consentIn(c, range) {
  if (!isObject(c)) return null;
  if (!range || !range.from) {
    const answered = isNumber(c.answered) ? c.answered : isNumber(c.yes) && isNumber(c.no) ? c.yes + c.no : null;
    return { yes: c.yes ?? null, no: c.no ?? null, answered, shareYes: isNumber(c.yes) && answered ? c.yes / answered : null };
  }
  // The server lists every day from the first answer (0 on days without); before the first answer nothing was answered.
  if (!isObject(c.byDay)) return { yes: count0(c.yes), no: count0(c.no), answered: count0(c.answered), shareYes: null };
  const days = Object.values(filterDays(c.byDay, range));
  const yes = sumOf(days.map((r) => r?.yes)) ?? 0;
  const no = sumOf(days.map((r) => r?.no)) ?? 0;
  const answered = yes + no;
  return { yes, no, answered, shareYes: answered ? yes / answered : null };
}

function consentSection(d, s, f, range) {
  const c = d.consent;
  if (!isObject(c)) return { id: 'consent', title: s.consent, empty: s.noDataYet };
  const n = consentIn(c, range);
  const byPlatform = entries(c.byPlatform).map(([p, v]) => ({ label: s.platformNames?.[p] ?? p, cells: [f.number(v?.yes), f.number(v?.no)] }));
  const days = isObject(c.byDay) && Object.keys(c.byDay).length ? filterDays(c.byDay, range) : null;
  const view =
    days && Object.keys(days).length
      ? series([{ id: 'yes', label: s.yes, format: f.number }, { id: 'no', label: s.no, format: f.number }], (unit) => (unit === 'day' ? days : aggregate(days, unit, new Set())), f, s)
      : null;
  return {
    id: 'consent',
    title: s.consent,
    note: startNote(c.firstDate, range, s, f),
    tiles: [
      { label: s.yes, value: valueOf(n.yes, f, s) },
      { label: s.no, value: valueOf(n.no, f, s) },
      { label: s.answered, value: valueOf(n.answered, f, s) },
      { label: s.shareYes, value: isNumber(n.shareYes) ? f.share(n.shareYes) : s.noDataYet },
    ],
    tables: byPlatform.length
      ? [{ title: s.byPlatform, columns: [s.yes, s.no], rows: byPlatform, legend: s.noDataLegend, note: c.firstDate && d.period?.to ? fillText(s.coversAllData, { from: f.date(c.firstDate), to: f.date(d.period.to) }) : null }]
      : [],
    series: view,
    seriesEmpty: periodEmpty(Boolean(firstKey(c.byDay)), view, range, s),
  };
}

/** One store platform (iOS / Android): fetch time, reasons, the numbers per day/week/month, countries. */
function storePart(platform, p, s, f, range, to) {
  const title = s.storeNames?.[platform] ?? platform;
  if (!isObject(p)) return { title, empty: s.noDataYet };
  const allDays = isObject(p.days) ? p.days : {};
  const days = filterDays(allDays, range);
  // «All»: the weeks and months as the server sent them; a period: summed from its days.
  const given = (m) => (!range.from && isObject(m) && Object.keys(m).length ? m : null);
  const byUnit = (unit) => (unit === 'day' ? days : unit === 'week' ? given(p.byWeek) ?? aggregate(days, 'week') : given(p.byMonth) ?? aggregate(days, 'month'));
  // The columns: the metrics with a number on any day (the same columns whatever the period).
  const metrics = STORE_METRICS.filter((m) => Object.values(allDays).some((row) => isNumber(row?.[m])));
  // A metric that does not exist on this platform (not_on_ios / not_on_android) can never get data: not listed.
  const reasons = entries(p.reasons)
    .filter(([m, code]) => !metrics.includes(m) && !NEVER_REASONS.has(code))
    .map(([m, code]) => `${s.metrics?.[m] ?? m}: ${reasonText(code, s)}`);
  const countries = entries(p.countries)
    .map(([code, v]) => ({ code, v }))
    .sort((a, b) => (b.v?.downloads ?? -1) - (a.v?.downloads ?? -1) || a.code.localeCompare(b.code));
  const countryMetrics = COUNTRY_METRICS.filter((m) => countries.some((c) => isNumber(c.v?.[m])));
  const first = p.firstDate ?? firstKey(allDays);
  const view = metrics.length && Object.keys(days).length ? series(metrics.map((m) => ({ id: m, label: s.metrics?.[m] ?? m, format: f.number })), byUnit, f, s) : null;
  return {
    title,
    meta: [p.fetchedAt ? fillText(s.fetchedAt, { date: f.dateTime(p.fetchedAt) }) : s.notFetched, startNote(first, range, s, f)].filter(Boolean),
    notes: [reasonText(p.reason, s), ...reasons].filter(Boolean),
    empty: metrics.length ? (view ? null : s.noDataInPeriod) : s.noDataYet,
    series: view,
    // The countries are sums over every day the server has (they cannot follow the period).
    table: countryMetrics.length
      ? {
          title: s.countries,
          columns: countryMetrics.map((m) => s.metrics?.[m] ?? m),
          rows: countries.map(({ code, v }) => ({ label: code === 'ZZ' ? s.countryOther : f.country(code), cells: countryMetrics.map((m) => f.number(v?.[m])) })),
          legend: s.noDataLegend,
          note: first && to ? fillText(s.coversAllData, { from: f.date(first), to: f.date(to) }) : null,
        }
      : null,
  };
}

function storesSection(d, s, f, range) {
  const st = d.stores;
  if (!isObject(st)) return { id: 'stores', title: s.stores, empty: s.noDataYet };
  return {
    id: 'stores',
    title: s.stores,
    notes: [noteText(st.note, s)].filter(Boolean),
    parts: ['ios', 'android'].filter((p) => p in st).map((p) => storePart(p, st[p], s, f, range, d.period?.to ?? range.to)),
  };
}

function revenueSection(d, s, f, range) {
  const r = d.revenue;
  if (!isObject(r)) return { id: 'revenue', title: s.revenue, empty: s.noDataYet };
  const cur = typeof r.currency === 'string' ? r.currency : null;
  const conv = isObject(r.converted) ? r.converted : null;
  const to = conv?.currency ?? null;
  const hasRate = Boolean(conv && isNumber(conv.rate));
  const money = (v) => (cur ? f.money(v, cur) : f.number(v));
  // The converted amount is «ca.»; without a rate the cell is «–» and the rate line says why (never 0).
  const approxMoney = (v) => (hasRate && isNumber(v) ? fillText(s.approx, { value: f.money(v, to) }) : MISSING);
  const rateLine = !conv
    ? null
    : hasRate
      ? fillText(s.rate, { from: cur ?? MISSING, rate: f.rate(conv.rate), to, date: f.date(conv.date) }) + (conv.stale ? ` (${s.rateStale})` : '')
      : fillText(s.rateMissing, { currency: to });
  const columns = [s.activeSubscriptions, s.activeTrials, fillText(s.mrrIn, { currency: cur ?? MISSING }), ...(to ? [fillText(s.mrrIn, { currency: to })] : [])];
  const row = (label, v, conv2) => ({ label, cells: [f.number(v?.active_subscriptions), f.number(v?.active_trials), money(v?.mrr), ...(to ? [approxMoney(conv2?.mrr)] : [])] });
  const current = isObject(r.current) ? r.current : {};
  const plans = Object.keys(current);
  const platforms = Object.keys(isObject(current.all) ? current.all : {}).filter((p) => p !== 'all');
  const allDays = isObject(r.days) ? r.days : {};
  const days = filterDays(allDays, range);
  const convDays = isObject(conv?.days) ? conv.days : {};
  // Revenue per day with its converted value; weeks and months are the sums of the days.
  const joined = Object.fromEntries(Object.entries(days).map(([k, v]) => [k, { ...v, revenue_to: hasRate ? convDays[k]?.revenue ?? null : null }]));
  // Subscriptions, trials and MRR are the state on the newest day: they cannot follow the period.
  const snapshot = r.asOf ? fillText(s.snapshot, { what: s.activeSubscriptions, date: f.date(r.asOf) }) : null;
  const view = Object.keys(days).length
    ? series(
        [
          { id: 'revenue', label: fillText(s.revenueIn, { currency: cur ?? MISSING }), format: money },
          ...(to ? [{ id: 'revenue_to', label: fillText(s.revenueIn, { currency: to }), format: approxMoney }] : []),
          { id: 'new_customers', label: s.newCustomers, format: f.number },
          { id: 'cancellations', label: s.cancellations, format: f.number },
        ],
        (unit) => (unit === 'day' ? joined : aggregate(joined, unit, new Set())),
        f,
        s,
      )
    : null;
  return {
    id: 'revenue',
    title: s.revenue,
    meta: [r.asOf ? fillText(s.asOf, { date: f.date(r.asOf) }) : null, r.fetchedAt ? fillText(s.fetchedAt, { date: f.dateTime(r.fetchedAt) }) : s.notFetched, startNote(firstKey(allDays), range, s, f)].filter(Boolean),
    notes: [reasonText(r.reason, s), rateLine, noteText(r.note, s)].filter(Boolean),
    tables: [
      plans.length ? { title: s.byPlan, columns, rows: plans.map((p) => row(s.plans?.[p] ?? p, current[p]?.all, conv?.current?.[p]?.all)), legend: s.noDataLegend, note: snapshot } : null,
      platforms.length ? { title: s.byPlatform, columns, rows: platforms.map((p) => row(s.platformNames?.[p] ?? p, current.all?.[p], conv?.current?.all?.[p])), legend: s.noDataLegend, note: snapshot } : null,
    ].filter(Boolean),
    series: view,
    seriesEmpty: periodEmpty(Boolean(firstKey(allDays)), view, range, s),
  };
}

const rowsSection = (id, title, rows, s, note = null) => ({ id, title, rows, note, empty: rows.length ? null : s.noDataYet });

/**
 * The page as sections – all strings, laid out by renderStats(). Only the blocks the summary has get a section (the
 * period block is the choice at the top, periodBar()). data = the server's summary (lib/stats.js), eventNames = the
 * app's own names for its events in this language (event and «event:value» → name; a missing name shows the id).
 * options.period = one of PERIODS (default «all»), options.today = the UTC day it ends on (default the summary's
 * period.to, else today).
 */
export function statsView(data, t, lang, eventNames = {}, options = {}) {
  const s = t.stats;
  const f = formatters(lang);
  const d = isObject(data) ? data : {};
  const names = isObject(eventNames) ? eventNames : {};
  const range = periodRange(PERIODS.includes(options.period) ? options.period : DEFAULT_PERIOD, options.today ?? d.period?.to);
  const usage = usageNote(d, s, f);
  const builders = [
    ['active', () => activeSection(d, s, f)],
    ['db', () => dbSection(d, s, f, range)],
    ['providerClicks', () => providerSection(d, s, f, names, range)],
    ['consent', () => consentSection(d, s, f, range)],
    ['revenue', () => revenueSection(d, s, f, range)],
    ['stores', () => storesSection(d, s, f, range)],
    ['retention', () => rowsSection('retention', s.retention, entries(d.retention).map(([k, v]) => ({ label: retentionLabel(k, s), value: isNumber(v) ? f.share(v) : s.noDataYet })), s, usage)],
    ['onboarding', () => rowsSection('onboarding', s.onboarding, entries(d.onboarding).map(([k, v]) => ({ label: s.onboardingSteps?.[k] ?? k, value: valueOf(v, f, s) })), s, usage)],
    ['events', () => rowsSection('events', s.events, mapRows(d.events, (k) => names[k] ?? k, f), s, usage)],
    ['platforms', () => rowsSection('platforms', s.platforms, mapRows(d.platforms, (k) => s.platformNames?.[k] ?? k, f), s, usage)],
    ['versions', () => rowsSection('versions', s.versions, mapRows(d.versions, (k) => k, f), s, usage)],
    ['languages', () => rowsSection('languages', s.languages, mapRows(d.languages, f.language, f), s, usage)],
  ];
  return builders.filter(([k]) => k in d).map(([, build]) => build());
}

// ---- Rendering (textContent only) ----

let pagedCount = 0;

/** Writes the sections into box (an element). */
export function renderStats(box, sections, t, doc = document) {
  const s = t.stats;
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const notes = (parent, list) => {
    for (const n of list ?? []) if (n) parent.appendChild(el('p', 'muted stats-note', n));
  };
  const bar = (share) => {
    const track = el('span', 'stats-bar');
    track.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'stats-bar-fill');
    fill.style.inlineSize = `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
    track.appendChild(fill);
    return track;
  };
  // A long list: the first PAGE items, then a real button «Show 10 more» (and «Showing x of y») until all are shown.
  // The button names the list it fills (aria-controls); after a click the first new row gets the focus.
  const paged = (parent, list, items, make, moreParent = parent) => {
    list.id = `stats-list-${++pagedCount}`;
    parent.appendChild(list);
    let shown = 0;
    const more = el('div', 'stats-more');
    const status = el('p', 'muted stats-more-status');
    const button = el('button', 'stats-more-btn');
    button.type = 'button';
    button.setAttribute('aria-controls', list.id);
    const add = () => {
      const start = shown;
      for (const item of items.slice(shown, shown + PAGE)) list.appendChild(make(item));
      shown = Math.min(items.length, shown + PAGE);
      status.textContent = fillText(s.shownOf, { shown: String(shown), total: String(items.length) });
      button.textContent = fillText(s.showMore, { n: String(Math.min(PAGE, items.length - shown)) });
      more.hidden = shown >= items.length;
      return start;
    };
    button.addEventListener('click', () => {
      const start = add();
      const row = list.children[start];
      const target = row && (row.querySelector ? row.querySelector('th, dt') : null);
      if (target) {
        target.tabIndex = -1;
        if (typeof target.focus === 'function') target.focus();
      }
    });
    add();
    if (items.length > PAGE) {
      more.appendChild(status);
      more.appendChild(button);
      moreParent.appendChild(more);
    }
  };
  const rowsList = (parent, rows) => {
    paged(parent, el('dl', 'stats-rows'), rows, (row) => {
      const line = el('div', 'stats-row');
      line.appendChild(el('dt', null, row.label));
      line.appendChild(el('dd', `stats-value${row.value === s.noDataYet ? ' stats-none' : ''}`, row.value));
      if (row.bar != null) line.appendChild(bar(row.bar));
      return line;
    });
  };
  const table = (parent, columns, rows, firstBar = false) => {
    const wrap = el('div', 'stats-table-wrap');
    wrap.tabIndex = 0;
    const tb = el('table', 'stats-table');
    const head = el('thead');
    const hr = el('tr');
    hr.appendChild(el('td'));
    for (const c of columns) {
      const th = el('th', null, c);
      th.scope = 'col';
      hr.appendChild(th);
    }
    head.appendChild(hr);
    tb.appendChild(head);
    wrap.appendChild(tb);
    parent.appendChild(wrap);
    // The rows go into the table; «Show 10 more» goes under it (not inside the scrolling table).
    paged(tb, el('tbody'), rows, (r) => {
      const tr = el('tr');
      const th = el('th', null, r.label);
      th.scope = 'row';
      tr.appendChild(th);
      r.cells.forEach((c, i) => {
        const td = el('td', c === MISSING ? 'missing' : null, c);
        if (i === 0 && firstBar && r.bar != null) td.appendChild(bar(r.bar));
        tr.appendChild(td);
      });
      return tr;
    }, parent);
  };
  const legend = (parent, text, rows) => {
    if (text && rows.some((r) => r.cells.includes(MISSING))) parent.appendChild(el('p', 'muted stats-legend', text));
  };
  // A series: a By day / By week / By month switch (toggle buttons) + the table for the chosen unit (week first).
  let seriesCount = 0;
  const seriesBlock = (sr) => {
    const wrap = el('div', 'stats-series');
    const units = ['day', 'week', 'month'].filter((u) => sr.views[u]);
    const switcher = el('div', 'stats-switch');
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', s.showBy);
    const holder = el('div');
    holder.id = `stats-series-${++seriesCount}-${pagedCount}`;
    const show = (unit) => {
      holder.textContent = '';
      table(holder, sr.columns, sr.views[unit], true);
      legend(holder, sr.legend, sr.views[unit]);
      for (const b of switcher.children) b.setAttribute('aria-pressed', String(b.getAttribute('data-unit') === unit));
    };
    const label = { day: s.byDay, week: s.byWeek, month: s.byMonth };
    for (const u of units) {
      const b = el('button', 'stats-switch-btn', label[u]);
      b.type = 'button';
      b.setAttribute('data-unit', u);
      b.setAttribute('aria-controls', holder.id);
      b.addEventListener('click', () => show(u));
      switcher.appendChild(b);
    }
    if (units.length > 1) wrap.appendChild(switcher);
    wrap.appendChild(holder);
    show(units.includes('week') ? 'week' : units[0]);
    return wrap;
  };
  const tiles = (list) => {
    const grid = el('div', 'stats-tiles');
    for (const tile of list) {
      const one = el('div', 'stats-tile');
      one.appendChild(el('span', `stats-tile-value${tile.value === s.noDataYet ? ' stats-none' : ''}`, tile.value));
      one.appendChild(el('span', 'muted', tile.label));
      grid.appendChild(one);
    }
    return grid;
  };

  box.textContent = '';
  for (const sec of sections) {
    const card = el('section', 'admin-card stats-section');
    card.setAttribute('data-section', sec.id);
    const h = el('h3', null, sec.title);
    h.id = `stats-${sec.id}`;
    card.setAttribute('aria-labelledby', h.id);
    card.appendChild(h);
    if (sec.text) card.appendChild(el('p', 'stats-period', sec.text));
    if (sec.note) card.appendChild(el('p', 'muted stats-note', sec.note));
    if (sec.meta?.length) card.appendChild(el('p', 'muted stats-note', sec.meta.join(' · ')));
    notes(card, sec.notes);
    if (sec.empty) card.appendChild(el('p', 'stats-none', sec.empty));
    if (sec.tiles) card.appendChild(tiles(sec.tiles));
    if (sec.rows?.length) rowsList(card, sec.rows);
    for (const g of sec.groups ?? []) {
      card.appendChild(el('h4', null, g.title));
      if (g.rows.length) rowsList(card, g.rows);
      else card.appendChild(el('p', 'stats-none', g.empty));
      notes(card, g.notes);
    }
    for (const tb of sec.tables ?? []) {
      card.appendChild(el('h4', null, tb.title));
      notes(card, [tb.note]);
      table(card, tb.columns, tb.rows);
      legend(card, tb.legend, tb.rows);
    }
    if (sec.series || sec.seriesEmpty) card.appendChild(el('h4', null, s.overTime));
    if (sec.series) card.appendChild(seriesBlock(sec.series));
    else if (sec.seriesEmpty) card.appendChild(el('p', 'stats-none', sec.seriesEmpty));
    for (const part of sec.parts ?? []) {
      const sub = el('div', 'stats-part');
      sub.appendChild(el('h4', null, part.title));
      if (part.meta?.length) sub.appendChild(el('p', 'muted stats-note', part.meta.join(' · ')));
      notes(sub, part.notes);
      if (part.empty) sub.appendChild(el('p', 'stats-none', part.empty));
      if (part.series) sub.appendChild(seriesBlock(part.series));
      if (part.table) {
        sub.appendChild(el('h5', null, part.table.title));
        notes(sub, [part.table.note]);
        table(sub, part.table.columns, part.table.rows);
        legend(sub, part.table.legend, part.table.rows);
      }
      card.appendChild(sub);
    }
    box.appendChild(card);
  }
}

/** The chosen period, kept while the page is open (also when the test-traffic switch fetches the numbers again). */
let chosenPeriod = DEFAULT_PERIOD;

/**
 * The whole statistics page into box: the period choice at the top (toggle buttons in a labelled group, the chosen one
 * aria-pressed), then the sections for that period. Choosing a period writes the sections again; the focus stays on the
 * chosen button, and only the line with the period's days is read out (the sections are not a live region).
 */
export function mountStats(box, data, t, lang, eventNames = {}, options = {}, doc = document) {
  const s = t.stats;
  const today = options.today ?? null;
  if (PERIODS.includes(options.period)) chosenPeriod = options.period;
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  box.textContent = '';
  const top = el('section', 'admin-card stats-section stats-periods');
  top.setAttribute('data-section', 'period');
  const h = el('h3', null, s.period);
  h.id = 'stats-period';
  top.setAttribute('aria-labelledby', h.id);
  top.appendChild(h);
  const group = el('div', 'stats-switch stats-period-switch');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', h.id);
  const range = el('p', 'stats-period');
  range.setAttribute('aria-live', 'polite');
  const note = el('p', 'muted stats-note');
  top.appendChild(group);
  top.appendChild(range);
  top.appendChild(note);
  const sections = el('div', 'stats-sections');
  sections.setAttribute('aria-live', 'off');
  box.appendChild(top);
  box.appendChild(sections);
  const buttons = {};
  const draw = () => {
    const view = periodBar(data, t, lang, chosenPeriod, today);
    range.textContent = view.text;
    note.textContent = view.note ?? '';
    note.hidden = !view.note;
    for (const c of view.choices) buttons[c.id].setAttribute('aria-pressed', String(c.pressed));
    renderStats(sections, statsView(data, t, lang, eventNames, { period: chosenPeriod, today }), t, doc);
  };
  for (const id of PERIODS) {
    const b = el('button', 'stats-switch-btn', s.periods?.[id] ?? id);
    b.type = 'button';
    b.setAttribute('data-period', id);
    b.setAttribute('aria-controls', 'stats-sections');
    b.addEventListener('click', () => {
      if (chosenPeriod === id) return;
      chosenPeriod = id;
      draw();
    });
    buttons[id] = b;
    group.appendChild(b);
  }
  sections.id = 'stats-sections';
  draw();
  return { choose: (id) => { if (PERIODS.includes(id)) { chosenPeriod = id; draw(); } } };
}

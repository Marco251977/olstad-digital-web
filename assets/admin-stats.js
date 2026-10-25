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

export const MISSING = '–';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const fillText = (template, vars) => String(template ?? '').replace(/%(\w+)%/g, (m, k) => (k in vars ? vars[k] : m));
const entries = (v) => (isObject(v) ? Object.entries(v) : []);

/** Store metrics in the shared order (PlanTravel and Saldo: store_stats_daily). active_devices is a level, not a sum. */
export const STORE_METRICS = ['downloads', 'redownloads', 'uninstalls', 'active_devices', 'page_views', 'store_acquisitions', 'crashes', 'anrs'];
const LEVEL_METRICS = new Set(['active_devices']);
const COUNTRY_METRICS = ['downloads', 'uninstalls', 'page_views'];
/** How many rows a series shows per view (newest first). */
const SERIES_LIMIT = { day: 31, week: 26, month: 24 };

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
 * { key: { columnId: value } } map for that unit (null when the unit is not available).
 */
function series(columns, byUnit, f, s) {
  const views = {};
  for (const unit of ['day', 'week', 'month']) {
    const map = byUnit(unit);
    if (!isObject(map) || !Object.keys(map).length) continue;
    const keys = Object.keys(map).sort().reverse().slice(0, SERIES_LIMIT[unit]);
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

// ---- Sections ----

function periodSection(d, s, f) {
  const p = d.period;
  return {
    id: 'period',
    title: s.period,
    text: isObject(p) && p.from && p.to ? fillText(s.periodRange, { from: f.date(p.from), to: f.date(p.to) }) : s.noDataYet,
    note: d.includesTest === true ? s.withTest : d.includesTest === false ? s.withoutTest : null,
  };
}

function activeSection(d, s, f) {
  const a = isObject(d.active) ? d.active : {};
  return { id: 'active', title: s.active, tiles: [['day', s.day], ['week', s.week], ['month', s.month]].map(([k, label]) => ({ label, value: valueOf(a[k], f, s) })) };
}

function dbSection(d, s, f) {
  const db = d.db;
  if (!isObject(db)) return { id: 'db', title: s.db, empty: s.noDataYet };
  const first = [db.newAccounts?.firstDate, db.newPlans?.firstDate].filter(Boolean).sort()[0];
  return {
    id: 'db',
    title: s.db,
    note: first ? fillText(s.since, { date: f.date(first) }) : null,
    tiles: [
      { label: s.newAccounts, value: valueOf(db.newAccounts?.total, f, s) },
      { label: s.newPlans, value: valueOf(db.newPlans?.total, f, s) },
      { label: s.activePlans, value: valueOf(db.activePlans, f, s) },
    ],
    series: series(
      [{ id: 'accounts', label: s.newAccounts, format: f.number }, { id: 'plans', label: s.newPlans, format: f.number }],
      joinBlocks({ accounts: db.newAccounts, plans: db.newPlans }),
      f,
      s,
    ),
  };
}

function providerSection(d, s, f, names) {
  const pc = d.providerClicks;
  if (!isObject(pc)) return { id: 'providerClicks', title: s.providerClicks, empty: s.noDataYet };
  const typeName = (k) => names[`provider_click:${k}`] ?? k;
  const byType = isObject(pc.byType) ? pc.byType : {};
  const totals = (map) => Object.fromEntries(entries(map).map(([k, v]) => [k, v?.total]));
  const types = Object.keys(byType).sort();
  // The total per day/week/month = the sum of the types (every click has exactly one type).
  const total = { byDay: {}, byWeek: {}, byMonth: {} };
  for (const t of types) for (const prop of Object.keys(total)) for (const [k, v] of entries(byType[t][prop])) if (isNumber(v)) total[prop][k] = (total[prop][k] ?? 0) + v;
  return {
    id: 'providerClicks',
    title: s.providerClicks,
    note: pc.from ? fillText(s.since, { date: f.date(pc.from) }) : null,
    tiles: [{ label: s.total, value: valueOf(pc.total, f, s) }],
    groups: [
      { title: s.byProvider, rows: mapRows(totals(pc.byProvider), (k) => k, f), empty: s.noDataYet },
      { title: s.byType, rows: mapRows(totals(byType), typeName, f), empty: s.noDataYet },
    ],
    series: types.length
      ? series([{ id: 'total', label: s.total, format: f.number }, ...types.map((t) => ({ id: t, label: typeName(t), format: f.number }))], joinBlocks({ total, ...byType }), f, s)
      : null,
  };
}

function consentSection(d, s, f) {
  const c = d.consent;
  if (!isObject(c)) return { id: 'consent', title: s.consent, empty: s.noDataYet };
  const share = isObject(c.shareOfActiveDevices) ? c.shareOfActiveDevices : null;
  const shareValue = share && isNumber(share.value) ? (share.estimate ? fillText(s.approx, { value: f.share(share.value) }) : f.share(share.value)) : s.noDataYet;
  const shareNotes = share
    ? [share.basis === 'store_active_devices' && isNumber(share.devices) ? fillText(s.basisStore, { devices: f.number(share.devices) }) : null, reasonText(share.reason, s)].filter(Boolean)
    : [];
  const byPlatform = entries(c.byPlatform).map(([p, v]) => ({ label: s.platformNames?.[p] ?? p, cells: [f.number(v?.yes), f.number(v?.no)] }));
  const days = isObject(c.byDay) && Object.keys(c.byDay).length ? c.byDay : null;
  return {
    id: 'consent',
    title: s.consent,
    note: c.firstDate ? fillText(s.since, { date: f.date(c.firstDate) }) : null,
    tiles: [
      { label: s.yes, value: valueOf(c.yes, f, s) },
      { label: s.no, value: valueOf(c.no, f, s) },
      { label: s.answered, value: valueOf(c.answered, f, s) },
      { label: s.shareYes, value: isNumber(c.shareYes) ? f.share(c.shareYes) : s.noDataYet },
    ],
    groups: [{ title: s.shareOfActive, rows: [{ label: s.shareOfActive, value: shareValue }], notes: shareNotes }],
    tables: byPlatform.length ? [{ title: s.byPlatform, columns: [s.yes, s.no], rows: byPlatform, legend: s.noDataLegend }] : [],
    series: days
      ? series([{ id: 'yes', label: s.yes, format: f.number }, { id: 'no', label: s.no, format: f.number }], (unit) => (unit === 'day' ? days : aggregate(days, unit, new Set())), f, s)
      : null,
  };
}

/** One store platform (iOS / Android): fetch time, reasons, the numbers per day/week/month, countries. */
function storePart(platform, p, s, f) {
  const title = s.storeNames?.[platform] ?? platform;
  if (!isObject(p)) return { title, empty: s.noDataYet };
  const days = isObject(p.days) ? p.days : {};
  const given = (m) => (isObject(m) && Object.keys(m).length ? m : null);
  const byUnit = (unit) => (unit === 'day' ? days : unit === 'week' ? given(p.byWeek) ?? aggregate(days, 'week') : given(p.byMonth) ?? aggregate(days, 'month'));
  const metrics = STORE_METRICS.filter((m) => Object.values(days).some((row) => isNumber(row?.[m])));
  const reasons = entries(p.reasons)
    .filter(([m]) => !metrics.includes(m))
    .map(([m, code]) => `${s.metrics?.[m] ?? m}: ${reasonText(code, s)}`);
  const countries = entries(p.countries)
    .map(([code, v]) => ({ code, v }))
    .sort((a, b) => (b.v?.downloads ?? -1) - (a.v?.downloads ?? -1) || a.code.localeCompare(b.code));
  const countryMetrics = COUNTRY_METRICS.filter((m) => countries.some((c) => isNumber(c.v?.[m])));
  return {
    title,
    meta: [p.fetchedAt ? fillText(s.fetchedAt, { date: f.dateTime(p.fetchedAt) }) : s.notFetched, p.firstDate ? fillText(s.since, { date: f.date(p.firstDate) }) : null].filter(Boolean),
    notes: [reasonText(p.reason, s), ...reasons].filter(Boolean),
    empty: metrics.length ? null : s.noDataYet,
    series: metrics.length ? series(metrics.map((m) => ({ id: m, label: s.metrics?.[m] ?? m, format: f.number })), byUnit, f, s) : null,
    table: countryMetrics.length
      ? {
          title: s.countries,
          columns: countryMetrics.map((m) => s.metrics?.[m] ?? m),
          rows: countries.map(({ code, v }) => ({ label: code === 'ZZ' ? s.countryOther : f.country(code), cells: countryMetrics.map((m) => f.number(v?.[m])) })),
          legend: s.noDataLegend,
        }
      : null,
  };
}

function storesSection(d, s, f) {
  const st = d.stores;
  if (!isObject(st)) return { id: 'stores', title: s.stores, empty: s.noDataYet };
  return {
    id: 'stores',
    title: s.stores,
    notes: [noteText(st.note, s)].filter(Boolean),
    parts: ['ios', 'android'].filter((p) => p in st).map((p) => storePart(p, st[p], s, f)),
  };
}

function revenueSection(d, s, f) {
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
  const days = isObject(r.days) ? r.days : {};
  const convDays = isObject(conv?.days) ? conv.days : {};
  // Revenue per day with its converted value; weeks and months are the sums of the days.
  const joined = Object.fromEntries(Object.entries(days).map(([k, v]) => [k, { ...v, revenue_to: hasRate ? convDays[k]?.revenue ?? null : null }]));
  return {
    id: 'revenue',
    title: s.revenue,
    meta: [r.asOf ? fillText(s.asOf, { date: f.date(r.asOf) }) : null, r.fetchedAt ? fillText(s.fetchedAt, { date: f.dateTime(r.fetchedAt) }) : s.notFetched].filter(Boolean),
    notes: [reasonText(r.reason, s), rateLine, noteText(r.note, s)].filter(Boolean),
    tables: [
      plans.length ? { title: s.byPlan, columns, rows: plans.map((p) => row(s.plans?.[p] ?? p, current[p]?.all, conv?.current?.[p]?.all)), legend: s.noDataLegend } : null,
      platforms.length ? { title: s.byPlatform, columns, rows: platforms.map((p) => row(s.platformNames?.[p] ?? p, current.all?.[p], conv?.current?.all?.[p])), legend: s.noDataLegend } : null,
    ].filter(Boolean),
    series: Object.keys(days).length
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
      : null,
  };
}

const rowsSection = (id, title, rows, s) => ({ id, title, rows, empty: rows.length ? null : s.noDataYet });

/**
 * The page as sections – all strings, laid out by renderStats(). Only the blocks the summary has get a section.
 * data = the server's summary (lib/stats.js), eventNames = the app's own names for its events in this language
 * (event and «event:value» → name; a missing name shows the id).
 */
export function statsView(data, t, lang, eventNames = {}) {
  const s = t.stats;
  const f = formatters(lang);
  const d = isObject(data) ? data : {};
  const names = isObject(eventNames) ? eventNames : {};
  const builders = [
    ['period', () => periodSection(d, s, f)],
    ['active', () => activeSection(d, s, f)],
    ['db', () => dbSection(d, s, f)],
    ['providerClicks', () => providerSection(d, s, f, names)],
    ['consent', () => consentSection(d, s, f)],
    ['revenue', () => revenueSection(d, s, f)],
    ['stores', () => storesSection(d, s, f)],
    ['usage', () => (isObject(d.usage) ? rowsSection('usage', s.usage, mapRows(d.usage, (k) => k, f), s) : { id: 'usage', title: s.usage, empty: s.noDataYet })],
    ['retention', () => rowsSection('retention', s.retention, entries(d.retention).map(([k, v]) => ({ label: retentionLabel(k, s), value: isNumber(v) ? f.share(v) : s.noDataYet })), s)],
    ['onboarding', () => rowsSection('onboarding', s.onboarding, entries(d.onboarding).map(([k, v]) => ({ label: s.onboardingSteps?.[k] ?? k, value: valueOf(v, f, s) })), s)],
    ['events', () => rowsSection('events', s.events, mapRows(d.events, (k) => names[k] ?? k, f), s)],
    ['platforms', () => rowsSection('platforms', s.platforms, mapRows(d.platforms, (k) => s.platformNames?.[k] ?? k, f), s)],
    ['versions', () => rowsSection('versions', s.versions, mapRows(d.versions, (k) => k, f), s)],
    ['languages', () => rowsSection('languages', s.languages, mapRows(d.languages, f.language, f), s)],
  ];
  return builders.filter(([k]) => k in d).map(([, build]) => build());
}

// ---- Rendering (textContent only) ----

/** Writes the view into box (an element). */
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
  const rowsList = (rows) => {
    const list = el('dl', 'stats-rows');
    for (const row of rows) {
      const line = el('div', 'stats-row');
      line.appendChild(el('dt', null, row.label));
      line.appendChild(el('dd', `stats-value${row.value === s.noDataYet ? ' stats-none' : ''}`, row.value));
      if (row.bar != null) line.appendChild(bar(row.bar));
      list.appendChild(line);
    }
    return list;
  };
  const table = (columns, rows, firstBar = false) => {
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
    const body = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      const th = el('th', null, r.label);
      th.scope = 'row';
      tr.appendChild(th);
      r.cells.forEach((c, i) => {
        const td = el('td', c === MISSING ? 'missing' : null, c);
        if (i === 0 && firstBar && r.bar != null) td.appendChild(bar(r.bar));
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
    tb.appendChild(body);
    wrap.appendChild(tb);
    return wrap;
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
    holder.id = `stats-series-${++seriesCount}`;
    const show = (unit) => {
      holder.textContent = '';
      holder.appendChild(table(sr.columns, sr.views[unit], true));
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
    if (sec.rows?.length) card.appendChild(rowsList(sec.rows));
    for (const g of sec.groups ?? []) {
      card.appendChild(el('h4', null, g.title));
      if (g.rows.length) card.appendChild(rowsList(g.rows));
      else card.appendChild(el('p', 'stats-none', g.empty));
      notes(card, g.notes);
    }
    for (const tb of sec.tables ?? []) {
      card.appendChild(el('h4', null, tb.title));
      card.appendChild(table(tb.columns, tb.rows));
      legend(card, tb.legend, tb.rows);
    }
    if (sec.series) {
      card.appendChild(el('h4', null, s.overTime));
      card.appendChild(seriesBlock(sec.series));
    }
    for (const part of sec.parts ?? []) {
      const sub = el('div', 'stats-part');
      sub.appendChild(el('h4', null, part.title));
      if (part.meta?.length) sub.appendChild(el('p', 'muted stats-note', part.meta.join(' · ')));
      notes(sub, part.notes);
      if (part.empty) sub.appendChild(el('p', 'stats-none', part.empty));
      if (part.series) sub.appendChild(seriesBlock(part.series));
      if (part.table) {
        sub.appendChild(el('h5', null, part.table.title));
        sub.appendChild(table(part.table.columns, part.table.rows));
        legend(sub, part.table.legend, part.table.rows);
      }
      card.appendChild(sub);
    }
    box.appendChild(card);
  }
}

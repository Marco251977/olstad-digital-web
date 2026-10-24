// /admin/<app>: the statistics the server sends (api/admin.js → lib/stats.js, already reduced to aggregate numbers),
// laid out as sections of label + value. statsView() is plain data (tested in test/admin-stats.test.mjs); renderStats()
// writes it with textContent only – nothing from the server is ever read as HTML.
// Texts: t.stats from i18n/home/<lang>.json (admin.stats), placeholders as %name%. Numbers, shares and dates via Intl in
// the page's language. A missing value is «–», never 0.

export const MISSING = '–';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const fillText = (template, vars) => String(template).replace(/%(\w+)%/g, (m, k) => (k in vars ? vars[k] : m));

export function formatters(lang) {
  const number = new Intl.NumberFormat(lang);
  const share = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' });
  let names = null;
  try { names = new Intl.DisplayNames([lang], { type: 'language' }); } catch (e) {}
  return {
    number: (v) => (isNumber(v) ? number.format(v) : MISSING),
    // A share is 0–1; a value over 1 is read as per cent.
    share: (v) => (isNumber(v) ? share.format(v > 1 ? v / 100 : v) : MISSING),
    date: (v) => {
      const d = typeof v === 'string' ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : null;
      return d && !Number.isNaN(d.getTime()) ? date.format(d) : MISSING;
    },
    language: (code) => {
      try { return (names && names.of(code)) || code; } catch (e) { return code; }
    },
  };
}

/** day1 / d7 / week2 / month1 → «Day 1», «Week 2» …; anything else: the text for the key, else the key. */
function retentionLabel(key, s) {
  const m = /^(d|day|w|week|m|month)[_-]?(\d+)$/i.exec(key);
  if (!m) return s.retentionNames?.[key] ?? key;
  const unit = m[1][0].toLowerCase();
  return fillText(s[unit === 'd' ? 'dayN' : unit === 'w' ? 'weekN' : 'monthN'], { n: m[2] });
}

/** A count map as rows, largest first; null / missing → one row «–». */
function mapRows(map, label, value) {
  if (!isObject(map)) return [{ label: MISSING, value: MISSING }];
  const rows = Object.entries(map)
    .filter(([, v]) => isNumber(v))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ label: label(k), value: value(v) }));
  return rows.length ? rows : [{ label: MISSING, value: MISSING }];
}

/** Numbers and nested count maps (onboarding, legacy) as rows; a nested map's rows are indented under its name. */
function numberRows(obj, label, f) {
  if (!isObject(obj)) return [{ label: MISSING, value: MISSING }];
  const rows = [];
  for (const [k, v] of Object.entries(obj)) {
    if (isNumber(v)) rows.push({ label: label(k), value: f.number(v) });
    else if (isObject(v)) {
      rows.push({ label: label(k), value: '', group: true });
      for (const r of mapRows(v, (x) => x, f.number)) rows.push({ ...r, sub: true });
    } else rows.push({ label: label(k), value: MISSING });
  }
  return rows.length ? rows : [{ label: MISSING, value: MISSING }];
}

/**
 * The page as sections { id, title, note?, rows: [{ label, value, sub?, group? }], tiles? } – all strings.
 * data = the server's summary (lib/stats.js), legacyUntil = the date the old numbers end (data/apps.json).
 */
export function statsView(data, t, lang, legacyUntil = null) {
  const s = t.stats;
  const f = formatters(lang);
  const d = isObject(data) ? data : {};
  const active = isObject(d.active) ? d.active : {};
  const p = d.period;
  const periodText = typeof p === 'string'
    ? p
    : isObject(p)
      ? fillText(s.periodRange, { from: f.date(p.from), to: f.date(p.to) })
      : MISSING;
  const sections = [
    {
      id: 'period',
      title: s.period,
      rows: [{ label: s.period, value: periodText }],
      note: d.includesTest === true ? s.withTest : d.includesTest === false ? s.withoutTest : null,
    },
    {
      id: 'active',
      title: s.active,
      tiles: [
        { label: s.day, value: f.number(active.day) },
        { label: s.week, value: f.number(active.week) },
        { label: s.month, value: f.number(active.month) },
      ],
      rows: [],
    },
    {
      id: 'retention',
      title: s.retention,
      rows: isObject(d.retention) && Object.keys(d.retention).length
        ? Object.entries(d.retention).map(([k, v]) => ({ label: retentionLabel(k, s), value: f.share(v) }))
        : [{ label: MISSING, value: MISSING }],
    },
    { id: 'onboarding', title: s.onboarding, rows: numberRows(d.onboarding, (k) => s.onboardingSteps?.[k] ?? k, f) },
    { id: 'events', title: s.events, rows: mapRows(d.events, (k) => s.eventNames?.[k] ?? k, f.number) },
    { id: 'providerClicks', title: s.providerClicks, rows: mapRows(d.providerClicks, (k) => k, f.number) },
    { id: 'platforms', title: s.platforms, rows: mapRows(d.platforms, (k) => s.platformNames?.[k] ?? k, f.number) },
    { id: 'versions', title: s.versions, rows: mapRows(d.versions, (k) => k, f.number) },
    { id: 'languages', title: s.languages, rows: mapRows(d.languages, f.language, f.number) },
    {
      id: 'legacy',
      title: fillText(s.legacy, { date: legacyUntil ? f.date(legacyUntil) : MISSING }),
      note: s.legacyNote,
      legacy: true,
      rows: numberRows(d.legacy, (k) => s.legacyNames?.[k] ?? (typeof s[k] === 'string' && !/%/.test(s[k]) ? s[k] : k), f),
    },
  ];
  return sections;
}

/** Writes the view into box (an element), with textContent only. */
export function renderStats(box, sections, doc = document) {
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  box.textContent = '';
  for (const sec of sections) {
    const card = el('section', `admin-card stats-section${sec.legacy ? ' stats-legacy' : ''}`);
    card.setAttribute('data-section', sec.id);
    const id = `stats-${sec.id}`;
    const h = el('h3', null, sec.title);
    h.id = id;
    card.setAttribute('aria-labelledby', id);
    card.appendChild(h);
    if (sec.note) card.appendChild(el('p', 'muted stats-note', sec.note));
    if (sec.tiles) {
      const tiles = el('div', 'stats-tiles');
      for (const tile of sec.tiles) {
        const box2 = el('div', 'stats-tile');
        box2.appendChild(el('span', 'stats-tile-value', tile.value));
        box2.appendChild(el('span', 'muted', tile.label));
        tiles.appendChild(box2);
      }
      card.appendChild(tiles);
    }
    if (sec.rows.length && !(sec.id === 'period')) {
      const list = el('dl', 'stats-rows');
      for (const row of sec.rows) {
        const line = el('div', `stats-row${row.sub ? ' sub' : ''}${row.group ? ' group' : ''}`);
        line.appendChild(el('dt', null, row.label));
        line.appendChild(el('dd', 'stats-value', row.value));
        list.appendChild(line);
      }
      card.appendChild(list);
    } else if (sec.id === 'period') {
      card.appendChild(el('p', 'stats-period', sec.rows[0].value));
    }
    box.appendChild(card);
  }
}

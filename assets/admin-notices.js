// /admin/<app> «Abonnementsvarsel» (Saldo Pocket, 04.11): the proof log of the half-yearly «your subscription is running»
// notice, read only. The server fetches it (api/admin.js action «notices» → lib/notices.js, already reduced to known
// fields); this file lays it out with textContent only – nothing from the server is ever read as HTML.
//
// noticesMonths() and noticeRows() are plain data (tested in test/admin-notices.test.mjs); mountNotices() writes the
// section: the test-traffic switch (off = hidden, the default), the search on a purchase ID with every row for it, and the
// counts per month (sent, shown, closed) per channel. Loading, empty and error states; when the function or the table does
// not exist yet (Saldo has not published it), a clear message instead of a crash. Texts: t.notices from
// i18n/home/<lang>.json (admin.notices), placeholders as %name%. Dates, money and numbers via Intl in the page's language.

export const MISSING = '–';
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const fill = (template, vars) => String(template ?? '').replace(/%(\w+)%/g, (m, k) => (k in vars ? vars[k] : m));
/** The purchase ID's shape (the same as lib/notices.js PURCHASE_ID). */
export const PURCHASE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
/** Store names are brands (not translated); an unknown code is shown as it is. */
const STORES = { app_store: 'App Store', appStore: 'App Store', APP_STORE: 'App Store', play_store: 'Google Play', playStore: 'Google Play', PLAY_STORE: 'Google Play' };

/** Digits after the decimal point for a currency (the store's price is in its smallest unit). */
export function currencyDigits(currency) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; }
}

export function formatters(lang) {
  const number = new Intl.NumberFormat(lang);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' });
  const month = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const toDate = (v) => {
    const d = typeof v === 'string' ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v.replace(' ', 'T')) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  /** A moment in the given time zone (the phone's, for «shown»), else in the browser's. */
  const moment = (v, timeZone) => {
    const d = toDate(v);
    if (!d) return MISSING;
    try { return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(d); } catch (e) {
      return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    }
  };
  return {
    number: (v) => (isNumber(v) ? number.format(v) : MISSING),
    date: (v) => (toDate(v) ? date.format(toDate(v)) : MISSING),
    month: (key) => (toDate(`${key}-01`) ? month.format(toDate(`${key}-01`)) : key),
    moment,
    money: (minor, currency) => {
      if (!isNumber(minor) || !currency) return MISSING;
      const value = minor / 10 ** currencyDigits(currency);
      try { return new Intl.NumberFormat(lang, { style: 'currency', currency }).format(value); } catch (e) { return `${number.format(value)} ${currency}`; }
    },
  };
}

/** The months as table rows: newest month first, one row per month and channel; a count that is missing = «–», never 0. */
export function noticesMonths(months, t, lang) {
  const n = t.notices;
  const f = formatters(lang);
  const list = Array.isArray(months) ? months.filter((m) => m && typeof m.month === 'string') : [];
  list.sort((a, b) => (a.month === b.month ? String(a.channel).localeCompare(String(b.channel)) : a.month < b.month ? 1 : -1));
  return {
    columns: [n.channel, n.sent, n.shown, n.dismissed],
    rows: list.map((m) => ({ label: f.month(m.month), cells: [n.channels?.[m.channel] ?? m.channel ?? MISSING, f.number(m.sent), f.number(m.shown), f.number(m.dismissed)] })),
  };
}

/** One log row as label/value lines, in the order the brief names them. */
export function noticeRows(rows, t, lang) {
  const n = t.notices;
  const f = formatters(lang);
  const yesNo = (v) => (v === true ? n.yes : v === false ? n.no : MISSING);
  const at = (v) => (v ? f.moment(v) : MISSING);
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const shown = r.shown_at_utc ? `${f.moment(r.shown_at_utc, r.shown_tz)}${r.shown_tz ? ` (${r.shown_tz})` : ''}` : MISSING;
    const price = r.price_missing === true || !isNumber(r.price_minor) ? n.priceMissing : f.money(r.price_minor, r.currency);
    return {
      title: f.date(r.due_on),
      test: r.test_traffic === true,
      lines: [
        { label: n.dueOn, value: f.date(r.due_on) },
        { label: n.kind, value: n.kinds?.[r.notice_kind] ?? r.notice_kind ?? MISSING },
        { label: n.channel, value: n.channels?.[r.channel] ?? r.channel ?? MISSING },
        { label: n.shown, value: shown },
        { label: n.dismissed, value: at(r.dismissed_at) },
        { label: n.manage, value: r.manage_tapped_at ? at(r.manage_tapped_at) : n.no },
        { label: n.emailSent, value: at(r.email_sent_at) },
        { label: n.resendId, value: r.resend_id ?? MISSING },
        { label: n.plan, value: n.plans?.[r.plan] ?? r.plan ?? MISSING },
        { label: n.store, value: STORES[r.store] ?? r.store ?? MISSING },
        { label: n.product, value: r.product ?? MISSING },
        { label: n.price, value: price, none: price === n.priceMissing },
        { label: n.textVersion, value: r.text_version ?? MISSING },
        { label: n.testTraffic, value: yesNo(r.test_traffic) },
        { label: n.retainUntil, value: f.date(r.retain_until) },
      ],
    };
  });
}

/** The server's error as a text: the function/table not there yet, not set up, a wrong ID, or the shared texts. */
export function errorText(j, t, failText) {
  const n = t.notices;
  if (j.error === 'notices_missing') return n.missing;
  if (j.error === 'notices_not_configured') return `${n.notConfigured}${j.missing ? ` (${j.missing.join(', ')})` : ''}`;
  if (j.error === 'bad_request') return n.badId;
  const f = failText ? failText(j) : ['failed', ''];
  return `${n.failed} ${t[f[0]] ?? ''}${f[1] ? ` (${f[1]})` : ''}`.trim();
}

/**
 * The section into box. call(body) → Promise of the server's JSON with .status (the page's own call); failText(j) →
 * [key, detail] (the page's own error texts). Returns { reload } for the page.
 */
export function mountNotices(box, t, lang, call, failText, doc = document) {
  const n = t.notices;
  const app = box.getAttribute('data-app');
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  box.textContent = '';
  const head = el('section', 'admin-card stats-section admin-notices-head');
  const h = el('h3', null, n.title);
  h.id = 'notices-title';
  head.setAttribute('aria-labelledby', h.id);
  head.appendChild(h);
  head.appendChild(el('p', 'muted stats-note', n.intro));
  const toggleLabel = el('label', 'admin-toggle');
  const toggle = el('input');
  toggle.type = 'checkbox';
  toggle.id = 'notices-include-test';
  toggle.setAttribute('role', 'switch');
  toggleLabel.appendChild(toggle);
  toggleLabel.appendChild(el('span', null, n.includeTest));
  head.appendChild(toggleLabel);
  const form = el('form', 'admin-notices-search');
  form.setAttribute('role', 'search');
  const label = el('label', null, n.purchaseLabel);
  label.htmlFor = 'notices-purchase';
  const row = el('div', 'admin-notices-row');
  const input = el('input');
  input.id = 'notices-purchase';
  input.name = 'purchase';
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'none');
  input.setAttribute('aria-describedby', 'notices-purchase-hint');
  const button = el('button', 'btn primary', n.search);
  button.type = 'submit';
  row.appendChild(input);
  row.appendChild(button);
  const hint = el('p', 'muted stats-note', n.searchHint);
  hint.id = 'notices-purchase-hint';
  form.appendChild(label);
  form.appendChild(row);
  form.appendChild(hint);
  head.appendChild(form);
  const results = el('div', 'admin-notices-results');
  results.setAttribute('aria-live', 'polite');
  head.appendChild(results);
  box.appendChild(head);

  const monthsCard = el('section', 'admin-card stats-section');
  const mh = el('h3', null, n.monthsTitle);
  mh.id = 'notices-months-title';
  monthsCard.setAttribute('aria-labelledby', mh.id);
  monthsCard.appendChild(mh);
  const monthsBody = el('div');
  monthsBody.setAttribute('aria-live', 'polite');
  monthsCard.appendChild(monthsBody);
  box.appendChild(monthsCard);

  const status = (parent, text, cls = 'muted') => {
    parent.textContent = '';
    const p = el('p', cls, text);
    parent.appendChild(p);
    return p;
  };
  const failed = (parent, j, again) => {
    parent.removeAttribute('aria-busy');
    const p = status(parent, errorText(j, t, failText), 'stats-none');
    if (again && j.error !== 'bad_request') {
      const b = el('button', 'btn ghost', t.retry);
      b.type = 'button';
      b.addEventListener('click', again);
      p.appendChild(el('br'));
      p.appendChild(b);
    }
  };
  const table = (parent, view) => {
    const wrap = el('div', 'stats-table-wrap');
    wrap.tabIndex = 0;
    const tb = el('table', 'stats-table');
    const thead = el('thead');
    const hr = el('tr');
    const corner = el('th', null, n.month);
    corner.scope = 'col';
    hr.appendChild(corner);
    for (const c of view.columns) {
      const th = el('th', null, c);
      th.scope = 'col';
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    tb.appendChild(thead);
    const body = el('tbody');
    for (const r of view.rows) {
      const tr = el('tr');
      const th = el('th', null, r.label);
      th.scope = 'row';
      tr.appendChild(th);
      for (const c of r.cells) tr.appendChild(el('td', c === MISSING ? 'missing' : null, c));
      body.appendChild(tr);
    }
    tb.appendChild(body);
    wrap.appendChild(tb);
    parent.appendChild(wrap);
  };

  const loadMonths = () => {
    status(monthsBody, n.loading);
    monthsBody.setAttribute('aria-busy', 'true');
    return call({ action: 'notices', app, view: 'months', includeTest: toggle.checked }).then((j) => {
      if (j.status !== 200) return failed(monthsBody, j, loadMonths);
      monthsBody.removeAttribute('aria-busy');
      const view = noticesMonths(j.data?.months, t, lang);
      if (!view.rows.length) return status(monthsBody, n.monthsEmpty, 'stats-none');
      monthsBody.textContent = '';
      table(monthsBody, view);
    }, () => failed(monthsBody, { error: 'offline', status: 0 }, loadMonths));
  };

  let lastId = '';
  const search = () => {
    const id = input.value.trim();
    if (!id) { results.textContent = ''; lastId = ''; return Promise.resolve(); }
    if (!PURCHASE_ID.test(id)) return Promise.resolve(failed(results, { error: 'bad_request' }));
    lastId = id;
    status(results, n.loading);
    results.setAttribute('aria-busy', 'true');
    return call({ action: 'notices', app, view: 'purchase', purchase: id, includeTest: toggle.checked }).then((j) => {
      if (id !== lastId) return;
      if (j.status !== 200) return failed(results, j, search);
      results.removeAttribute('aria-busy');
      const list = noticeRows(j.data?.rows, t, lang);
      results.textContent = '';
      results.appendChild(el('h4', null, fill(n.resultsFor, { id })));
      if (!list.length) return results.appendChild(el('p', 'stats-none', n.rowsEmpty));
      for (const item of list) {
        const one = el('div', 'admin-notices-item');
        one.appendChild(el('h5', null, item.test ? `${item.title} · ${n.testTraffic}` : item.title));
        const dl = el('dl', 'stats-rows');
        for (const line of item.lines) {
          const div = el('div', 'stats-row');
          div.appendChild(el('dt', null, line.label));
          div.appendChild(el('dd', `stats-value${line.value === MISSING || line.none ? ' stats-none' : ''}`, line.value));
          dl.appendChild(div);
        }
        one.appendChild(dl);
        results.appendChild(one);
      }
    }, () => failed(results, { error: 'offline', status: 0 }, search));
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    search();
  });
  toggle.addEventListener('change', () => {
    loadMonths();
    if (lastId) search();
  });
  loadMonths();
  return { reload: () => { loadMonths(); if (lastId) search(); } };
}

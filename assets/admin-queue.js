// /admin/<app>: «Til godkjenning» – ONE queue component for every app (Marco 25.10: everything that waits for his approval
// is collected at the top of the app's admin page, behind the same sign-in as the statistics). The server sends the app's
// queue (api/admin.js → lib/approval.js, already reduced to known fields); an app without a queue gets data null =
// «Nothing is waiting for approval». Approve / reject / «fetch a new picture» go back through /api/admin to the app's own
// server, which runs its own logic (PlanTravel: the same functions as its old admin queue).
//
// queueModel() is plain data (tested in test/admin-queue.test.mjs); renderQueue() writes it with textContent only –
// nothing from the server is ever read as HTML. Texts: t.queue from i18n/home/<lang>.json (admin.queue), placeholders
// as %name%. Item types: today «destination_images» (PlanTravel's pictures for Inspirer meg and the trip plans); a new
// type = one entry in RENDERERS (and its texts), the shell never changes.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fill = (template, vars) => String(template ?? '').replace(/%(\w+)%/g, (m, k) => (k in vars ? vars[k] : m));

/** The sections that have something waiting, the overview panels, and the total – plain data. */
export function queueModel(data) {
  if (!isObject(data)) return { empty: true, sections: [], overview: null, total: 0 };
  const sections = (Array.isArray(data.sections) ? data.sections : []).filter((s) => isObject(s) && Array.isArray(s.items) && s.items.length);
  const total = sections.reduce((n, s) => n + (s.count || 0), 0);
  return { empty: sections.length === 0, sections, overview: isObject(data.overview) ? data.overview : null, total };
}

/** The text for one source chip: «Inspirer meg · app · production · ios». */
export function sourceText(s, q) {
  const name = (q.sources && q.sources[s.source]) || q.sourceUnknown;
  return [name, s.channel || q.channelUnknown, s.platform].filter(Boolean).join(' · ');
}

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function link(doc, href, text) {
  if (!href) return el(doc, 'span', null, text);
  const a = el(doc, 'a', null, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function picture(doc, url, alt) {
  if (!url) return el(doc, 'div', 'queue-img queue-img-missing', '–');
  const img = doc.createElement('img');
  img.className = 'queue-img';
  img.src = url;
  img.alt = alt;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  return img;
}

function actionButton(doc, cls, label, onClick) {
  const b = el(doc, 'button', `btn ${cls}`, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** PlanTravel's pictures: one card per place, its candidate photos with Approve / Reject / Fetch a new picture. */
const RENDERERS = {
  destination_images(doc, group, q, act) {
    const card = el(doc, 'article', 'admin-card queue-group');
    const h = el(doc, 'h4', 'queue-place', group.placeName || group.city);
    if (group.country) h.appendChild(el(doc, 'span', 'muted queue-country', ` (${group.country})`));
    card.appendChild(h);
    const chips = el(doc, 'p', 'queue-chips');
    if (group.sources && group.sources.length) for (const s of group.sources) chips.appendChild(el(doc, 'span', 'queue-chip', sourceText(s, q)));
    else chips.appendChild(el(doc, 'span', 'queue-chip', q.noSources));
    card.appendChild(chips);
    if (group.alreadyHasImage) card.appendChild(el(doc, 'p', 'queue-warn', q.replaceWarning));
    const list = el(doc, 'ul', 'queue-candidates');
    for (const c of group.candidates) {
      const li = el(doc, 'li', 'queue-candidate');
      li.appendChild(picture(doc, c.imageUrl, group.placeName || group.city));
      const meta = el(doc, 'p', 'queue-meta');
      const who = c.photographerName || q.unknownPhotographer;
      // «Foto: <name>» with the name as the photographer's link (the words around it from the language file).
      const [before, after = ''] = String(q.photo).split('%name%');
      if (before) meta.appendChild(el(doc, 'span', null, before));
      meta.appendChild(link(doc, c.photographerUrl, who));
      if (after) meta.appendChild(el(doc, 'span', null, after));
      if (c.unsplashPhotoUrl) {
        meta.appendChild(el(doc, 'br'));
        meta.appendChild(link(doc, c.unsplashPhotoUrl, q.seeOnUnsplash));
      }
      li.appendChild(meta);
      const buttons = el(doc, 'div', 'queue-actions');
      const req = (action) => ({ type: 'destination_images', id: c.id, action, city: group.city, country: group.country || '', placeId: group.placeId || '' });
      buttons.appendChild(actionButton(doc, 'primary', q.approve, () => act(req('approve'), li)));
      buttons.appendChild(actionButton(doc, 'danger', q.reject, () => act(req('reject'), li)));
      buttons.appendChild(actionButton(doc, 'ghost', q.refetch, () => act(req('refetch'), li)));
      li.appendChild(buttons);
      list.appendChild(li);
    }
    card.appendChild(list);
    return card;
  },
};

/** The overview for PlanTravel's pictures: stopped before the queue (14 days) and «switch approved picture». */
function renderOverview(doc, overview, q, number, act) {
  const out = [];
  if (!overview.placeSchemaReady) {
    out.push(el(doc, 'p', 'admin-card muted', q.schemaNotReady));
    return out;
  }
  const drops = el(doc, 'section', 'admin-card queue-panel');
  drops.appendChild(el(doc, 'h4', null, q.dropsTitle));
  const reasons = Object.entries(overview.drops || {}).sort((a, b) => b[1] - a[1]);
  if (!reasons.length) drops.appendChild(el(doc, 'p', 'muted', q.noDrops));
  else {
    const dl = el(doc, 'dl', 'stats-rows');
    for (const [reason, n] of reasons) {
      const row = el(doc, 'div', 'stats-row');
      row.appendChild(el(doc, 'dt', null, (q.drops && q.drops[reason]) || reason));
      row.appendChild(el(doc, 'dd', null, number(n)));
      dl.appendChild(row);
    }
    drops.appendChild(dl);
  }
  out.push(drops);
  const alt = el(doc, 'section', 'admin-card queue-panel');
  alt.appendChild(el(doc, 'h4', null, q.altTitle));
  alt.appendChild(el(doc, 'p', 'muted queue-hint', q.altHint));
  if (!overview.alternatives || !overview.alternatives.length) alt.appendChild(el(doc, 'p', 'muted', q.noAlternatives));
  for (const p of overview.alternatives || []) {
    const h = el(doc, 'h5', 'queue-place', p.placeName);
    if (p.country) h.appendChild(el(doc, 'span', 'muted queue-country', ` (${p.country})`));
    alt.appendChild(h);
    const list = el(doc, 'ul', 'queue-candidates');
    for (const ph of p.photos) {
      const li = el(doc, 'li', 'queue-candidate');
      li.appendChild(picture(doc, ph.imageUrl, p.placeName));
      li.appendChild(el(doc, 'p', 'queue-meta', `${fill(q.storedAs, { name: ph.storedName })} · ${fill(q.photo, { name: ph.photographerName || q.unknownPhotographer })}`));
      const actions = el(doc, 'div', 'queue-actions');
      if (ph.current) actions.appendChild(el(doc, 'span', 'queue-current', q.inUse));
      else actions.appendChild(actionButton(doc, 'primary', q.useThis, () => act({ type: 'destination_images', id: ph.id, action: 'approve' }, li)));
      li.appendChild(actions);
      list.appendChild(li);
    }
    alt.appendChild(list);
  }
  out.push(alt);
  return out;
}

/** Writes the queue into box. act(request, itemElement) runs one action. */
export function renderQueue(box, data, t, lang, act, doc = document) {
  const q = t.queue;
  const number = (n) => new Intl.NumberFormat(lang).format(n);
  const model = queueModel(data);
  box.textContent = '';
  if (model.empty) box.appendChild(el(doc, 'p', 'admin-card muted', t.approvalEmpty));
  else {
    box.appendChild(el(doc, 'p', 'muted queue-hint', q.intro));
    for (const s of model.sections) {
      const render = RENDERERS[s.type];
      const section = el(doc, 'section', 'queue-section');
      const h = el(doc, 'h3', null, (q.types && q.types[s.type]) || s.type);
      h.appendChild(el(doc, 'span', 'queue-count', number(s.count)));
      section.appendChild(h);
      for (const group of s.items) if (render) section.appendChild(render(doc, group, q, act));
      box.appendChild(section);
    }
  }
  if (model.overview) for (const panel of renderOverview(doc, model.overview, q, number, act)) box.appendChild(panel);
  return model;
}

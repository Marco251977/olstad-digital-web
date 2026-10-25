// «Til godkjenning» for /admin/<app> (Marco 25.10): everything that waits for Marco's approval, in one queue on the app's
// admin page, behind the same sign-in as the statistics. Fetched on the server only (api/admin.js, actions «queue»,
// «queueCount», «queueAction»). An app gets a queue by naming a source in data/apps.json (home.approval.source); no source =
// the empty queue («Nothing is waiting for approval»). A new source = one entry in SOURCES.
//
// PlanTravel (source «plantravel»): its server's /approval-queue/* (server/lib/approval-queue.js in the PlanTravel repo, the
// same handlers as the old admin's queue: approve = verifyDestinationImage, reject = rejectDestinationImage, refetch =
// reject + a replacement batch from Unsplash), with «Authorization: Bearer <PLANTRAVEL_ADMIN_QUEUE_KEY>» – its own key,
// only in the server's environment (Vercel), never sent to the browser.
//
// The answer is never passed on as it is: queueView() keeps only the known fields of the known types (place names,
// photographer credits, https image and photo links, ids, counts), so nothing else reaches the page.

export const SOURCES = {
  plantravel: {
    url: 'PLANTRAVEL_API_URL',
    key: 'PLANTRAVEL_ADMIN_QUEUE_KEY',
  },
};

/** The item types the page knows, and the actions each allows. */
export const TYPES = { destination_images: ['approve', 'reject', 'refetch'] };

const TIMEOUT_MS = 20_000;
const MAX_ITEMS = 500;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PLACE_ID = /^Q\d{1,12}$/;
const CODE = /^[a-z0-9_]{1,40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const code = (v) => (typeof v === 'string' && CODE.test(v) ? v : null);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
/** An https URL without user info (the images and links PlanTravel stores, today Unsplash's), else ''. */
export function httpsUrl(v) {
  try {
    const u = new URL(String(v));
    return u.protocol === 'https:' && !u.username && !u.password && u.href.length <= 2000 ? u.href : '';
  } catch {
    return '';
  }
}

function candidate(c) {
  if (!isObject(c) || !ID.test(String(c.id ?? ''))) return null;
  return {
    id: String(c.id),
    imageUrl: httpsUrl(c.imageUrl),
    photographerName: text(c.photographerName),
    photographerUrl: httpsUrl(c.photographerUrl),
    unsplashPhotoUrl: httpsUrl(c.unsplashPhotoUrl),
    createdAt: typeof c.createdAt === 'string' && ISO_DATE.test(c.createdAt) ? c.createdAt : null,
    isReplacement: c.isReplacement === true,
  };
}

function imageGroup(g) {
  if (!isObject(g)) return null;
  const candidates = (Array.isArray(g.candidates) ? g.candidates : []).slice(0, MAX_ITEMS).map(candidate).filter(Boolean);
  if (!candidates.length) return null;
  return {
    key: text(g.key, 80),
    placeId: PLACE_ID.test(String(g.placeId ?? '')) ? String(g.placeId) : null,
    city: text(g.city),
    placeName: text(g.placeName) || text(g.city),
    country: text(g.country, 60) || null,
    sources: (Array.isArray(g.sources) ? g.sources : []).slice(0, 20).filter(isObject).map((s) => ({ source: code(s.source), platform: code(s.platform), channel: code(s.channel) })),
    alreadyHasImage: g.alreadyHasImage === true,
    candidates,
  };
}

function alternative(p) {
  if (!isObject(p) || !PLACE_ID.test(String(p.placeId ?? ''))) return null;
  const photos = (Array.isArray(p.photos) ? p.photos : []).slice(0, 50).filter(isObject).map((ph) => {
    const imageUrl = httpsUrl(ph.imageUrl);
    if (!imageUrl || !ID.test(String(ph.id ?? ''))) return null;
    return { id: String(ph.id), storedName: text(ph.storedName), imageUrl, photographerName: text(ph.photographerName), current: ph.current === true };
  }).filter(Boolean);
  return photos.length ? { placeId: String(p.placeId), placeName: text(p.placeName), country: text(p.country, 60) || null, photos } : null;
}

/** PlanTravel's GET /approval-queue reduced to what the page shows. Unknown types are left out. */
export function queueView(raw) {
  const r = isObject(raw) ? raw : {};
  const sections = (Array.isArray(r.sections) ? r.sections : [])
    .filter((s) => isObject(s) && Object.hasOwn(TYPES, s.type))
    .map((s) => {
      const items = (Array.isArray(s.items) ? s.items : []).slice(0, MAX_ITEMS).map(imageGroup).filter(Boolean);
      return { type: s.type, count: items.reduce((n, g) => n + g.candidates.length, 0), items };
    });
  const o = isObject(r.overview) ? r.overview : null;
  const totals = {};
  if (o && isObject(o.drops) && Array.isArray(o.drops.rows)) {
    for (const row of o.drops.rows.slice(0, 2000)) {
      const reason = isObject(row) ? code(row.reason) : null;
      if (reason && count(row.count) !== null) totals[reason] = (totals[reason] ?? 0) + count(row.count);
    }
  }
  const overview = o
    ? {
        placeSchemaReady: o.placeSchemaReady === true,
        drops: o.drops?.available === true ? totals : null,
        alternatives: (Array.isArray(o.alternatives) ? o.alternatives : []).slice(0, MAX_ITEMS).map(alternative).filter(Boolean),
      }
    : null;
  return { sections, overview, total: sections.reduce((n, s) => n + s.count, 0) };
}

/** The action's request, checked: a known type, an allowed action and a safe id; refetch also city/country/placeId. */
export function actionRequest(body) {
  const type = String(body?.type ?? '');
  const action = String(body?.action ?? '');
  const id = String(body?.id ?? '');
  if (!Object.hasOwn(TYPES, type) || !TYPES[type].includes(action) || !ID.test(id)) return null;
  const out = { type, action, id, body: {} };
  if (action === 'refetch') {
    out.body = { city: text(body.city), country: text(body.country, 60), placeId: PLACE_ID.test(String(body.placeId ?? '')) ? String(body.placeId) : null };
  }
  return out;
}

/** { status, body } – 200 with the answer, or an error code the page turns into a text. Never throws. */
async function call(source, env, fetcher, path, init = {}) {
  const def = SOURCES[source];
  const base = String(env[def.url] ?? '').trim().replace(/\/$/, '');
  const key = String(env[def.key] ?? '').trim();
  const missing = [!base && def.url, !key && def.key].filter(Boolean);
  if (missing.length) {
    console.error(`approval ${source}: not configured, missing ${missing.join(', ')}`);
    return { status: 503, body: { error: 'queue_not_configured', missing } };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetcher(`${base}${path}`, { ...init, signal: controller.signal, headers: { authorization: `Bearer ${key}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) } });
    if (r.status === 401 || r.status === 403) {
      console.error(`approval ${source}: refused ${r.status}`);
      return { status: 502, body: { error: 'queue_source_refused' } };
    }
    let json = null;
    try { json = await r.json(); } catch {}
    if (!r.ok) {
      console.error(`approval ${source}: ${path.split('/')[1]} ${r.status}`);
      return { status: 502, body: { error: 'queue_source', code: String(r.status) } };
    }
    return { status: 200, body: json };
  } catch (error) {
    const timeout = error?.name === 'AbortError';
    console.error(`approval ${source}: ${timeout ? 'timeout' : error?.name ?? 'error'}`);
    return { status: timeout ? 504 : 502, body: { error: timeout ? 'queue_source_timeout' : 'queue_source', code: timeout ? '' : 'network' } };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchQueue(source, env = process.env, fetcher = fetch) {
  const r = await call(source, env, fetcher, '/approval-queue');
  return r.status === 200 ? { status: 200, body: queueView(r.body) } : r;
}

export async function fetchQueueCount(source, env = process.env, fetcher = fetch) {
  const r = await call(source, env, fetcher, '/approval-queue/count');
  return r.status === 200 ? { status: 200, body: { total: count(r.body?.total) } } : r;
}

/** One approve / reject / refetch, passed on to the app's server (which runs its own, unchanged logic). */
export async function queueAction(source, request, env = process.env, fetcher = fetch) {
  const r = await call(source, env, fetcher, `/approval-queue/${request.type}/${encodeURIComponent(request.id)}/${request.action}`, { method: 'POST', body: JSON.stringify(request.body) });
  return r.status === 200 ? { status: 200, body: { done: true, action: request.action } } : r;
}

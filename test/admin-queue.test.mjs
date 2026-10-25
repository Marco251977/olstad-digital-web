// «Til godkjenning» on /admin/<app> (Marco 25.10): the approval queue behind the same sign-in as the statistics. PlanTravel's
// queue is fetched on the website's server with PLANTRAVEL_ADMIN_QUEUE_KEY (never sent to the browser); approve / reject /
// fetch a new picture are passed on to PlanTravel's /approval-queue/*, which runs its own (old) queue logic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { CORE_LANGUAGES } from 'app-core';

import { handle } from '../api/admin.js';
import { queueModel, renderQueue, sourceText } from '../assets/admin-queue.js';
import { SESSION_COOKIE, sessionValue } from '../lib/admin-auth.js';
import { actionRequest, httpsUrl, queueView } from '../lib/approval.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const KEY = 'queue-key-abcdef-123456';
const STATS = 'stats-key-not-for-queue';
const ENV = { ADMIN_EMAILS: 'owner@example.com', ADMIN_PASSWORD_HASH: '$2b$04$test.hash.only.for.signing.cookies..', ADMIN_SESSION_SECRET: 'test-session-secret', PLANTRAVEL_API_URL: 'https://api.plantravel.example/', PLANTRAVEL_STATS_KEY: STATS, PLANTRAVEL_ADMIN_QUEUE_KEY: KEY };

const QUEUE = {
  sections: [{
    type: 'destination_images', label: 'Reisemålbilder', count: 2,
    items: [{
      key: 'Q585', placeId: 'Q585', city: 'oslo', placeName: 'Oslo', country: 'NO', alreadyHasImage: true,
      sources: [{ source: 'inspire_app', platform: 'ios', channel: 'production' }],
      candidates: [
        { id: 'c1', imageUrl: 'https://images.unsplash.com/photo-1?w=1080', photographerName: 'Kari <b>', photographerUrl: 'https://unsplash.com/@kari?utm_source=PlanTravel', unsplashPhotoId: 'x', unsplashPhotoUrl: 'https://unsplash.com/photos/x', createdAt: '2026-10-25T10:00:00Z', isReplacement: true, secret: 'drop me' },
        { id: 'c2', imageUrl: 'javascript:alert(1)', photographerName: '', photographerUrl: 'http://evil.example', createdAt: 'yesterday' },
      ],
    }],
  }, { type: 'users', count: 1, items: [{ email: 'a@b.c' }] }],
  overview: {
    placeSchemaReady: true,
    alternatives: [{ placeId: 'Q90', placeName: 'Paris', country: 'FR', photos: [{ id: 'p1', storedName: 'paris', imageUrl: 'https://images.unsplash.com/p1', photographerName: 'A', current: true }, { id: 'p2', storedName: 'parigi', imageUrl: 'https://images.unsplash.com/p2', photographerName: 'B', current: false }] }],
    drops: { available: true, rows: [{ day: '2026-10-24', reason: 'test', source: 'inspire_app', channel: 'preview', count: 3 }, { day: '2026-10-25', reason: 'test', count: 2 }, { reason: 'bot', count: 1 }] },
  },
};

function fakeFetch(answer = () => ({ status: 200, body: QUEUE })) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', auth: init.headers?.authorization, body: init.body });
      const a = answer(String(url), init);
      return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
    },
  };
}
const session = (who) => (who ? { cookie: `${SESSION_COOKIE}=${sessionValue(who === 'good' ? 'owner@example.com' : 'other@example.com', ENV)}` } : {});
const post = (body, who = 'good', env = ENV, fetcher) => handle(new Request('https://h/api/admin', { method: 'POST', headers: session(who), body: JSON.stringify(body) }), env, fetcher);

test('the queue needs the sign-in: no cookie → 401, another address → 403, PlanTravel never asked', async () => {
  const f = fakeFetch();
  for (const action of ['queue', 'queueCount', 'queueAction']) {
    assert.equal((await post({ action, app: 'plantravel', request: { type: 'destination_images', id: 'c1', action: 'approve' } }, null, ENV, f.fetcher)).status, 401, action);
    assert.equal((await post({ action, app: 'plantravel', request: { type: 'destination_images', id: 'c1', action: 'approve' } }, 'other', ENV, f.fetcher)).status, 403, action);
  }
  assert.equal(f.calls.length, 0);
});

test('signed in: the queue key goes to PlanTravel as a Bearer header from the server only – never the stats key, never back', async () => {
  const f = fakeFetch();
  const r = await post({ action: 'queue', app: 'plantravel' }, 'good', ENV, f.fetcher);
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://api.plantravel.example/approval-queue');
  assert.equal(f.calls[0].auth, `Bearer ${KEY}`);
  assert.ok(!text.includes(KEY) && !text.includes(STATS), 'no key in the answer');
  assert.ok(!text.includes('drop me') && !text.includes('a@b.c') && !text.includes('javascript:'), 'only known fields');
});

test('the queue key is required: missing → 503 queue_not_configured with the setting name, PlanTravel not asked', async () => {
  const f = fakeFetch();
  const env = { ...ENV, PLANTRAVEL_ADMIN_QUEUE_KEY: '' };
  const r = await post({ action: 'queue', app: 'plantravel' }, 'good', env, f.fetcher);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'queue_not_configured', missing: ['PLANTRAVEL_ADMIN_QUEUE_KEY'] });
  assert.equal(f.calls.length, 0);
  const refused = await post({ action: 'queue', app: 'plantravel' }, 'good', ENV, fakeFetch(() => ({ status: 401, body: { error: 'unauthorized' } })).fetcher);
  assert.equal(refused.status, 502);
  assert.equal((await refused.json()).error, 'queue_source_refused');
});

test('approve / reject / refetch are passed on to PlanTravel’s same queue actions; anything else is refused', async () => {
  const f = fakeFetch(() => ({ status: 200, body: { verified: true } }));
  for (const action of ['approve', 'reject', 'refetch']) {
    const r = await post({ action: 'queueAction', app: 'plantravel', request: { type: 'destination_images', id: 'c1', action, city: 'oslo', country: 'NO', placeId: 'Q585' } }, 'good', ENV, f.fetcher);
    assert.equal(r.status, 200, action);
    assert.deepEqual(await r.json(), { done: true, action });
  }
  assert.deepEqual(f.calls.map((c) => [c.method, c.url, c.auth]), [
    ['POST', 'https://api.plantravel.example/approval-queue/destination_images/c1/approve', `Bearer ${KEY}`],
    ['POST', 'https://api.plantravel.example/approval-queue/destination_images/c1/reject', `Bearer ${KEY}`],
    ['POST', 'https://api.plantravel.example/approval-queue/destination_images/c1/refetch', `Bearer ${KEY}`],
  ]);
  assert.deepEqual(JSON.parse(f.calls[2].body), { city: 'oslo', country: 'NO', placeId: 'Q585' });
  for (const request of [{ type: 'destination_images', id: 'c1', action: 'delete' }, { type: 'users', id: 'c1', action: 'approve' }, { type: 'destination_images', id: '../x', action: 'approve' }, null]) {
    const r = await post({ action: 'queueAction', app: 'plantravel', request }, 'good', ENV, f.fetcher);
    assert.equal(r.status, 400);
  }
  assert.equal(f.calls.length, 3);
  assert.equal(actionRequest({ type: 'destination_images', id: 'c1', action: 'refetch', placeId: 'x; drop' }).body.placeId, null);
});

test('an app without a queue (Saldo Pocket) has the empty queue, without asking anyone', async () => {
  const f = fakeFetch();
  const r = await post({ action: 'queue', app: 'saldo-pocket' }, 'good', ENV, f.fetcher);
  assert.deepEqual(await r.json(), { app: 'saldo-pocket', data: null, total: 0 });
  assert.equal((await post({ action: 'queueCount', app: 'saldo-pocket' }, 'good', ENV, f.fetcher)).status, 200);
  assert.equal((await post({ action: 'queueAction', app: 'saldo-pocket', request: { type: 'destination_images', id: 'a', action: 'approve' } }, 'good', ENV, f.fetcher)).status, 404);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(queueModel(null), { empty: true, sections: [], overview: null, total: 0 });
  const apps = JSON.parse(read('data/apps.json')).apps;
  assert.deepEqual(apps.find((a) => a.home?.id === 'plantravel').home.approval, { source: 'plantravel' });
  assert.equal(apps.find((a) => a.home?.id === 'saldo-pocket').home.approval, null);
});

test('queueView keeps only known fields: https pictures, safe ids, codes; drops summed per reason', () => {
  const v = queueView(QUEUE);
  assert.equal(v.sections.length, 1, 'unknown type left out');
  const g = v.sections[0].items[0];
  assert.equal(g.candidates.length, 2);
  assert.equal(g.candidates[0].imageUrl, 'https://images.unsplash.com/photo-1?w=1080');
  assert.equal(g.candidates[0].secret, undefined);
  assert.equal(g.candidates[1].imageUrl, '', 'not https → no picture, but the item stays approvable');
  assert.equal(g.candidates[1].photographerUrl, '');
  assert.equal(g.candidates[1].createdAt, null);
  assert.deepEqual(v.overview.drops, { test: 5, bot: 1 });
  assert.equal(v.total, 2);
  assert.equal(httpsUrl('https://user:pw@x.example/'), '');
  assert.equal(sourceText({ source: 'inspire_app', channel: null, platform: 'ios' }, { sources: { inspire_app: 'Inspirer meg · app' }, channelUnknown: 'kanal ukjent' }), 'Inspirer meg · app · kanal ukjent · ios');
});

test('the queue is written with textContent only, with buttons for every candidate and the switch panel', () => {
  const made = [];
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.listeners = {}; made.push(this); }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener(k, f) { this.listeners[k] = f; }
    set innerHTML(v) { throw new Error('innerHTML used'); }
  }
  const doc = { createElement: (tag) => new El(tag) };
  const box = new El('div');
  const t = JSON.parse(read('i18n/home/nb.json')).admin;
  const fillT = JSON.parse(JSON.stringify(t).replace(/\{\{(\w+)\}\}/g, '%$1%'));
  const acts = [];
  const model = renderQueue(box, queueView(QUEUE), fillT, 'nb', (req) => acts.push(req), doc);
  assert.equal(model.total, 2);
  const buttons = made.filter((e) => e.tag === 'button');
  assert.deepEqual(buttons.map((b) => b.textContent), ['Godkjenn', 'Avvis', 'Hent nytt bilde', 'Godkjenn', 'Avvis', 'Hent nytt bilde', 'Bruk dette']);
  buttons[0].listeners.click();
  buttons[2].listeners.click();
  buttons[6].listeners.click();
  assert.deepEqual(acts.map((a) => [a.id, a.action]), [['c1', 'approve'], ['c1', 'refetch'], ['p2', 'approve']]);
  assert.ok(made.some((e) => e.textContent === 'Kari <b>'), 'names as text');
  assert.ok(made.some((e) => e.textContent === t.queue.replaceWarning));
  assert.ok(made.some((e) => e.tag === 'img' && e.referrerPolicy === 'no-referrer'));
  assert.doesNotMatch(read('assets/admin-queue.js'), /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  for (const page of ['admin/plantravel.html', 'admin/saldo-pocket.html']) assert.doesNotMatch(read(page), /innerHTML|insertAdjacentHTML/);
});

test('texts: every language has the queue texts (keys, not text in the page)', () => {
  const en = JSON.parse(read('i18n/home/en.json')).admin.queue;
  for (const l of CORE_LANGUAGES) {
    const q = JSON.parse(read(`i18n/home/${l.code}.json`)).admin.queue;
    for (const k of ['approve', 'reject', 'refetch', 'loading', 'intro', 'replaceWarning', 'altTitle', 'useThis', 'inUse']) assert.ok(q[k], `${l.code} ${k}`);
    assert.deepEqual(Object.keys(q.drops), Object.keys(en.drops), l.code);
    assert.deepEqual(Object.keys(q.sources), Object.keys(en.sources), l.code);
  }
  const nb = JSON.parse(read('i18n/home/nb.json')).admin.queue;
  assert.equal(nb.approve, 'Godkjenn');
  assert.equal(nb.reject, 'Avvis');
  assert.equal(nb.refetch, 'Hent nytt bilde');
});

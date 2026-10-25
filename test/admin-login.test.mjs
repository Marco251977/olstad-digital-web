// /admin sign-in with e-mail + password (Marco 25.10): remembered 30 days in a signed HttpOnly cookie, the same answer for a
// wrong address and a wrong password, locked after 5 failures, «Log out» clears it, and the statistics refuse without it.
// The password in these tests is made up here; the real one is only in Marco's keys folder, its hash only in Vercel.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { beforeEach, test } from 'node:test';

import bcrypt from 'bcryptjs';

import { handle } from '../api/admin.js';
import { MAX_FAILURES, resetLockout, SESSION_COOKIE, SESSION_SECONDS, TRIES_COOKIE } from '../lib/admin-auth.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const PASSWORD = 'test-only-' + Math.random().toString(36).slice(2);
const ENV = {
  ADMIN_EMAILS: 'owner@example.com, second@example.com',
  ADMIN_PASSWORD_HASH: bcrypt.hashSync(PASSWORD, 4),
  ADMIN_SESSION_SECRET: 'test-session-secret-' + Math.random().toString(36).slice(2),
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
};
const noFetch = async () => {
  throw new Error('no network in the password sign-in');
};

let ip = 0;
const post = (body, { cookie, from = '203.0.113.1', env = ENV } = {}) =>
  handle(new Request('https://h/api/admin', { method: 'POST', headers: { 'x-forwarded-for': from, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }), env, noFetch);
const login = (email, password, opts) => post({ action: 'login', email, password }, opts);
/** The cookies a response sets, as «name=value» for the next request. */
const cookiesFrom = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const sessionHeader = (r) => r.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
const fresh = () => `198.51.100.${++ip}`;

beforeEach(() => resetLockout());

test('the right password sets a signed session cookie for 30 days: HttpOnly, Secure, SameSite=Strict, Path=/', async () => {
  const r = await login(' Owner@Example.com ', PASSWORD, { from: fresh() });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { email: 'owner@example.com' });
  const c = sessionHeader(r);
  assert.ok(c, 'a session cookie');
  assert.match(c, new RegExp(`Max-Age=${SESSION_SECONDS}(;|$)`));
  assert.equal(SESSION_SECONDS, 30 * 24 * 60 * 60);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/;']) assert.ok(c.includes(flag), flag);
  assert.ok(!c.includes(PASSWORD), 'the password is never in the cookie');
  // The cookie is the sign-in: «me» and the statistics answer with it.
  const me = await post({ action: 'me' }, { cookie: cookiesFrom(r) });
  assert.deepEqual([me.status, (await me.json()).email], [200, 'owner@example.com']);
});

test('a wrong password and an unknown address get the same answer, and no cookie', async () => {
  const wrongPassword = await login('owner@example.com', PASSWORD + 'x', { from: fresh() });
  const unknown = await login('someone@example.com', PASSWORD, { from: fresh() });
  const empty = await login('', '', { from: fresh() });
  for (const r of [wrongPassword, unknown, empty]) {
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'wrong_login' });
    assert.equal(sessionHeader(r), undefined);
  }
});

test('a tampered or expired cookie is no sign-in, and a new password signs everybody out', async () => {
  const r = await login('owner@example.com', PASSWORD, { from: fresh() });
  const value = sessionHeader(r).split(';')[0].split('=')[1];
  const [v, email, expires, sig] = value.split('.');
  const other = Buffer.from('someone@example.com').toString('base64url');
  for (const bad of [`${v}.${other}.${expires}.${sig}`, `${v}.${email}.${Number(expires) + 99999}.${sig}`, `${v}.${email}.${expires}.x${sig.slice(1)}`]) {
    assert.equal((await post({ action: 'me' }, { cookie: `${SESSION_COOKIE}=${bad}` })).status, 401, bad);
  }
  const newPassword = { ...ENV, ADMIN_PASSWORD_HASH: bcrypt.hashSync('another', 4) };
  assert.equal((await post({ action: 'me' }, { cookie: cookiesFrom(r), env: newPassword })).status, 401);
  // Taken off the list = out, even with a cookie that is still valid.
  assert.equal((await post({ action: 'me' }, { cookie: cookiesFrom(r), env: { ...ENV, ADMIN_EMAILS: 'second@example.com' } })).status, 403);
});

test(`locked after ${MAX_FAILURES} failures per address, per IP and per browser – even the right password waits`, async () => {
  // Per address (from different IPs).
  for (let i = 0; i < MAX_FAILURES; i++) assert.equal((await login('owner@example.com', 'wrong', { from: fresh() })).status, 401);
  let r = await login('owner@example.com', PASSWORD, { from: fresh() });
  assert.deepEqual([r.status, await r.json()], [429, { error: 'locked' }]);
  // The other address on the list is not locked by that.
  assert.equal((await login('second@example.com', PASSWORD, { from: fresh() })).status, 200);

  // Per IP (different addresses, the same IP).
  resetLockout();
  const one = fresh();
  for (let i = 0; i < MAX_FAILURES; i++) await login(`guess${i}@example.com`, 'wrong', { from: one });
  assert.equal((await login('owner@example.com', PASSWORD, { from: one })).status, 429);
  assert.equal((await login('owner@example.com', PASSWORD, { from: fresh() })).status, 200);

  // Per browser: the signed tries cookie also works when the server has forgotten (a new instance).
  resetLockout();
  let cookie = '';
  for (let i = 0; i < MAX_FAILURES; i++) {
    const fail = await login(`x${i}@example.com`, 'wrong', { from: fresh(), cookie });
    cookie = cookiesFrom(fail);
    assert.ok(cookie.startsWith(`${TRIES_COOKIE}=`));
    resetLockout();
  }
  r = await login('owner@example.com', PASSWORD, { from: fresh(), cookie });
  assert.equal(r.status, 429);
  // A forged tries cookie counts for nothing.
  assert.equal((await login('owner@example.com', PASSWORD, { from: fresh(), cookie: `${TRIES_COOKIE}=1-2-3-4-5.forged` })).status, 200);
});

test('«Log out» clears the cookie; after that «me» and the statistics are refused', async () => {
  const r = await login('owner@example.com', PASSWORD, { from: fresh() });
  const out = await post({ action: 'logout' }, { cookie: cookiesFrom(r) });
  assert.equal(out.status, 200);
  const cleared = sessionHeader(out);
  assert.match(cleared, new RegExp(`^${SESSION_COOKIE}=;`));
  assert.match(cleared, /Max-Age=0/);
  assert.ok(cleared.includes('Path=/;'), 'the same path as the cookie it clears');
  assert.equal((await post({ action: 'me' }, { cookie: cookiesFrom(out) })).status, 401);
});

test('the statistics API refuses without the session cookie (also with an old bearer token) and never asks a source', async () => {
  let asked = 0;
  const fetcher = async () => {
    asked++;
    return new Response('{}', { status: 200 });
  };
  for (const headers of [{}, { authorization: 'Bearer something' }, { cookie: `${SESSION_COOKIE}=v1.x.1.y` }]) {
    const r = await handle(new Request('https://h/api/admin', { method: 'POST', headers, body: JSON.stringify({ action: 'stats', app: 'plantravel' }) }), ENV, fetcher);
    assert.deepEqual([r.status, (await r.json()).error], [401, 'signed_out']);
  }
  assert.equal(asked, 0);
});

test('the page: a real form for the password manager, the e-mail code only behind «Forgot password?», noindex', () => {
  for (const page of ['admin.html', 'admin/plantravel.html', 'admin/saldo-pocket.html']) {
    const html = read(page);
    assert.match(html, /<form id="password-form"[^>]*method="post"/);
    assert.match(html, /<input id="login-email" name="username" type="email" autocomplete="username"/);
    assert.match(html, /<input id="password" name="password" type="password" autocomplete="current-password"/);
    assert.match(html, /<label for="login-email"/);
    assert.match(html, /<label for="password"/);
    assert.match(html, /id="forgot" data-t="forgotPassword"/);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.doesNotMatch(html, /sessionStorage\.setItem|authorization: 'Bearer/, 'the page keeps no token itself');
  }
  for (const lang of ['nb', 'en', 'ar', 'ja']) {
    const a = JSON.parse(read(`i18n/home/${lang}.json`)).admin;
    for (const k of ['password', 'wrongLogin', 'locked', 'forgotPassword', 'codeHint', 'usePassword']) assert.ok(a[k], `${lang} ${k}`);
  }
  assert.match(read('assets/home.css'), /\.admin-form \.link-btn \{[^}]*min-height: 44px/);
});

test('no secret in the repository: no password, no bcrypt hash, no session secret in a tracked file', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).split('\n').filter((f) => f && !f.startsWith('node_modules/') && !/\.(png|jpg|ico|woff2?|tgz)$/.test(f));
  const example = read('.env.example');
  for (const name of ['ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET']) assert.match(example, new RegExp(`^${name}=$`, 'm'), `${name} without a value`);
  const leaks = [];
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    } catch {
      continue;
    }
    // A real bcrypt hash (60 characters), a value after ADMIN_PASSWORD=/ADMIN_SESSION_SECRET=/…_KEY=, or a private key.
    if (/\$2[aby]\$1\d\$[./A-Za-z0-9]{53}/.test(text)) leaks.push(`${f}: bcrypt hash`);
    if (/^[ \t]*(ADMIN_PASSWORD|ADMIN_PASSWORD_HASH|ADMIN_SESSION_SECRET|[A-Z_]*_KEY)[ \t]*=[ \t]*\S+/m.test(text)) leaks.push(`${f}: a value after a secret's name`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) leaks.push(`${f}: private key`);
  }
  assert.deepEqual(leaks, []);
});

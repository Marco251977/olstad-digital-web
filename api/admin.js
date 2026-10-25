// /api/admin – sign-in for /admin and the statistics behind it.
// Sign-in (Marco 25.10): e-mail + password, the same for preview and production. Only the addresses in ADMIN_EMAILS
// (Vercel environment, comma separated) get in; the password is checked against its bcrypt hash ADMIN_PASSWORD_HASH (the
// password itself is only in Marco's keys folder). A right password sets a signed session cookie for 30 days (lib/admin-auth.js,
// signed with ADMIN_SESSION_SECRET); every request after that is checked against the cookie AND the allowlist. Wrong e-mail
// and wrong password give the same answer (401 wrong_login); 5 failures in 15 minutes per e-mail, IP or browser = 429 locked
// (best-effort, see lib/admin-auth.js). The e-mail code (Supabase Auth in the Saldo project, SUPABASE_URL + SUPABASE_ANON_KEY)
// is kept only as the fallback behind «Forgot password?»: a right code sets the same 30-day cookie.
// Statistics per app: PLANTRAVEL_API_URL + PLANTRAVEL_STATS_KEY, SALDO_STATS_URL + SALDO_STATS_KEY (secret; see lib/stats.js).
// Names in .env.example.
// Actions (POST JSON): { action: 'login', email, password } · { action: 'code', email } · { action: 'verify', email, code } ·
// { action: 'me' } · { action: 'logout' } · { action: 'stats', app, includeTest } = that app's statistics (only apps in
// data/apps.json): data null until the app has a source (home.stats.source), else the aggregate numbers fetched on the server
// (lib/stats.js – the source's key never leaves the server; includeTest true = with test traffic, default off). 'me' and
// 'stats' need the session cookie (no cookie = 401 signed_out).
// «Til godkjenning» (lib/approval.js), also only with the session cookie: { action: 'queue', app } = the app's approval
// queue (data null when the app has no queue source, home.approval.source) · { action: 'queueCount', app } = { total } ·
// { action: 'queueAction', app, request: { type, id, action: 'approve' | 'reject' | 'refetch', city, country, placeId } } = passed on to
// the app's server, which runs its own queue logic. Errors: queue_not_configured (503), queue_source_refused /
// queue_source (502), queue_source_timeout (504), bad_request (400) for an unknown type/action/id.
// Every failure is an error code the page turns into a text: refused (403), wrong_login (401), locked / rate_limited (429),
// not_configured (503, with the missing setting names), wrong_code / signed_out (401), server (502, with Supabase's status and
// code); for the statistics also stats_not_configured (503), source_refused / source (502) and source_timeout (504).

import appList from '../data/apps.json' with { type: 'json' };
import { clearFailures, clearSessionCookie, locked, passwordMatches, recordFailure, sessionCookie, sessionEmail } from '../lib/admin-auth.js';
import { actionRequest, fetchQueue, fetchQueueCount, queueAction } from '../lib/approval.js';
import { fetchStats } from '../lib/stats.js';

/** The apps /admin shows: every app in the app list with a «home» part (the same list as the front page). */
export const ADMIN_APPS = appList.apps.filter((a) => a.home).map((a) => a.home.id);

const json = (status, body, cookies = []) => {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
};

export const normalizeEmail = (e) => String(e ?? '').trim().toLowerCase();

/** The allowlist from the environment; empty = nobody. */
export function allowlist(env = process.env) {
  return String(env.ADMIN_EMAILS ?? '').split(',').map(normalizeEmail).filter(Boolean);
}

export const allowed = (email, env = process.env) => {
  const e = normalizeEmail(email);
  return e !== '' && allowlist(env).includes(e);
};

/** Supabase's answer as one of our codes. Logged (step, status, Supabase's code – never the address) for Vercel's logs. */
async function authFailure(r, step) {
  let code = '';
  try {
    const body = await r.json();
    code = String(body.error_code ?? body.code ?? body.error ?? '');
  } catch {}
  console.error(`admin ${step}: supabase ${r.status} ${code}`);
  if (r.status === 429 || /rate_limit/.test(code)) return json(429, { error: 'rate_limited' });
  if (step === 'verify' && r.status >= 400 && r.status < 500) return json(401, { error: 'wrong_code' });
  return json(502, { error: 'server', status: r.status, code });
}

/** The request handled with the given environment and fetch (tests pass their own). Never throws. */
export async function handle(request, env = process.env, fetcher = fetch) {
  try {
    return await answer(request, env, fetcher);
  } catch (error) {
    console.error(`admin: ${error?.name ?? 'error'} ${error?.message ?? ''}`);
    return json(502, { error: 'server', code: 'exception' });
  }
}

async function answer(request, env, fetcher) {
  const url = String(env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
  const key = String(env.SUPABASE_ANON_KEY ?? '').trim();
  let body = {};
  try { body = await request.json(); } catch { return json(400, { error: 'bad_request' }); }
  // Signing out always works (clears the cookie), also when something is not set up.
  if (body.action === 'logout') return json(200, { signedOut: true }, [clearSessionCookie()]);
  // Which settings are missing (names only), so the page can say what is not set up. The e-mail code (the fallback) also
  // needs Supabase; the password and the session do not.
  const usesCode = body.action === 'code' || body.action === 'verify';
  const missing = [
    !allowlist(env).length && 'ADMIN_EMAILS',
    !String(env.ADMIN_PASSWORD_HASH ?? '').trim() && 'ADMIN_PASSWORD_HASH',
    !String(env.ADMIN_SESSION_SECRET ?? '').trim() && 'ADMIN_SESSION_SECRET',
    usesCode && !url && 'SUPABASE_URL',
    usesCode && !key && 'SUPABASE_ANON_KEY',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`admin: not configured, missing ${missing.join(', ')}`);
    return json(503, { error: 'not_configured', missing });
  }
  const auth = (path, init = {}) => fetcher(`${url}/auth/v1/${path}`, { ...init, headers: { apikey: key, 'content-type': 'application/json', ...(init.headers ?? {}) } });

  if (body.action === 'login') {
    const email = normalizeEmail(body.email);
    if (locked(request, email, env)) return json(429, { error: 'locked' });
    // Same bcrypt work and the same answer whether the address or the password is wrong.
    const ok = await passwordMatches(body.password, allowed(email, env), env);
    if (!ok) return json(401, { error: 'wrong_login' }, [recordFailure(request, email, env)]);
    return json(200, { email }, [sessionCookie(email, env), clearFailures(request, email, env)]);
  }
  if (body.action === 'code') {
    if (!allowed(body.email, env)) return json(403, { error: 'refused' });
    const r = await auth('otp', { method: 'POST', body: JSON.stringify({ email: normalizeEmail(body.email), create_user: true }) });
    return r.ok ? json(200, { sent: true }) : authFailure(r, 'code');
  }
  if (body.action === 'verify') {
    if (!allowed(body.email, env)) return json(403, { error: 'refused' });
    const code = String(body.code ?? '').replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(code)) return json(401, { error: 'wrong_code' });
    const r = await auth('verify', { method: 'POST', body: JSON.stringify({ type: 'email', email: normalizeEmail(body.email), token: code }) });
    if (!r.ok) return authFailure(r, 'verify');
    const session = await r.json();
    const email = normalizeEmail(session.user?.email);
    if (!allowed(email, env)) return json(403, { error: 'refused' });
    // The same 30-day session cookie as the password.
    return json(200, { email }, [sessionCookie(email, env), clearFailures(request, email, env)]);
  }
  if (['me', 'stats', 'queue', 'queueCount', 'queueAction'].includes(body.action)) {
    const email = sessionEmail(request, env);
    if (!email) return json(401, { error: 'signed_out' }, [clearSessionCookie()]);
    // Taken off the list = out, also with a cookie that is still valid.
    if (!allowed(email, env)) return json(403, { error: 'refused' }, [clearSessionCookie()]);
    if (body.action === 'me') return json(200, { email });
    if (!ADMIN_APPS.includes(body.app)) return json(404, { error: 'unknown_app' });
    const home = appList.apps.find((a) => a.home?.id === body.app).home;
    if (body.action !== 'stats') {
      const source = home.approval?.source;
      // No queue for this app (yet) – nothing is waiting.
      if (!source) return body.action === 'queueAction' ? json(404, { error: 'no_queue' }) : json(200, { app: body.app, data: null, total: 0 });
      if (body.action === 'queueCount') {
        const c = await fetchQueueCount(source, env, fetcher);
        return json(c.status, c.status === 200 ? { app: body.app, ...c.body } : c.body);
      }
      if (body.action === 'queue') {
        const q = await fetchQueue(source, env, fetcher);
        return json(q.status, q.status === 200 ? { app: body.app, data: q.body } : q.body);
      }
      const request = actionRequest(body.request);
      if (!request) return json(400, { error: 'bad_request' });
      console.log(`admin queue: ${body.app} ${request.type} ${request.action}`);
      const a = await queueAction(source, request, env, fetcher);
      return json(a.status, a.body);
    }
    // No statistics source connected (yet) – «No data yet».
    if (!home.stats?.source) return json(200, { app: body.app, data: null });
    const s = await fetchStats(home.stats.source, { includeTest: body.includeTest === true }, env, fetcher);
    return json(s.status, s.status === 200 ? { app: body.app, ...s.body } : s.body);
  }
  return json(400, { error: 'bad_request' });
}

export async function POST(request) {
  return handle(request);
}

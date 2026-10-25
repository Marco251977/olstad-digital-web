// /api/admin – sign-in for /admin with e-mail + one-time code (Supabase Auth in the Saldo project).
// Only the addresses in the allowlist get in: ADMIN_EMAILS (Vercel environment, comma separated) is checked here on
// the server before a code is sent, before a code is checked and on every request after sign-in. Everyone else gets
// 403, and no code is sent to them. Without ADMIN_EMAILS nobody gets in.
// Environment (Vercel): ADMIN_EMAILS, SUPABASE_URL, SUPABASE_ANON_KEY (the project's public key – the apps ship it),
// and per statistics source PLANTRAVEL_API_URL + PLANTRAVEL_STATS_KEY, SALDO_STATS_URL + SALDO_STATS_KEY (secret; see
// lib/stats.js). Names in .env.example.
// Actions (POST JSON): { action: 'code', email } · { action: 'verify', email, code } · { action: 'me' } + Bearer token ·
// { action: 'stats', app, includeTest } + Bearer token = that app's statistics (only apps in data/apps.json): data null until
// the app has a source (home.stats.source), else the aggregate numbers fetched on the server (lib/stats.js – the source's
// key never leaves the server; includeTest true = with test traffic, default off).
// Every failure is an error code the page turns into a text: refused (403), rate_limited (429), not_configured (503,
// with the missing setting names), wrong_code / signed_out (401), server (502, with Supabase's status and code); for the
// statistics also stats_not_configured (503), source_refused / source (502) and source_timeout (504).

import appList from '../data/apps.json' with { type: 'json' };
import { fetchStats } from '../lib/stats.js';

/** The apps /admin shows: every app in the app list with a «home» part (the same list as the front page). */
export const ADMIN_APPS = appList.apps.filter((a) => a.home).map((a) => a.home.id);

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

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
  if (step === 'user') return json(401, { error: 'signed_out' });
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
  // Which settings are missing (names only), so the page can say what is not set up.
  const missing = [!allowlist(env).length && 'ADMIN_EMAILS', !url && 'SUPABASE_URL', !key && 'SUPABASE_ANON_KEY'].filter(Boolean);
  if (missing.length) {
    console.error(`admin: not configured, missing ${missing.join(', ')}`);
    return json(503, { error: 'not_configured', missing });
  }
  let body = {};
  try { body = await request.json(); } catch { return json(400, { error: 'bad_request' }); }
  const auth = (path, init = {}) => fetcher(`${url}/auth/v1/${path}`, { ...init, headers: { apikey: key, 'content-type': 'application/json', ...(init.headers ?? {}) } });

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
    if (!allowed(session.user?.email, env)) return json(403, { error: 'refused' });
    return json(200, { accessToken: session.access_token, expiresIn: session.expires_in });
  }
  if (body.action === 'me' || body.action === 'stats') {
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return json(401, { error: 'signed_out' });
    // Supabase checks the token (signature and expiry) and gives the user it belongs to.
    const r = await auth('user', { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return authFailure(r, 'user');
    const user = await r.json();
    if (!allowed(user.email, env)) return json(403, { error: 'refused' });
    if (body.action === 'me') return json(200, { email: user.email });
    if (!ADMIN_APPS.includes(body.app)) return json(404, { error: 'unknown_app' });
    const home = appList.apps.find((a) => a.home?.id === body.app).home;
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

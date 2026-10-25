// The /admin sign-in session and the lockout for wrong passwords (Marco 25.10: e-mail + password, remembered 30 days,
// the same for preview and production; the e-mail code only behind «Forgot password?»).
// - The password is never here: only its bcrypt hash, in the Vercel environment ADMIN_PASSWORD_HASH (the password itself is
//   in Marco's keys folder). The session is a signed cookie (HMAC-SHA256 with ADMIN_SESSION_SECRET + the password hash, so a
//   new password signs everybody out): «v1.<e-mail>.<expires>.<signature>», HttpOnly, Secure, SameSite=Strict, Path=/
//   (covers /admin and /api/admin), Max-Age 30 days. The e-mail in it is checked against ADMIN_EMAILS on every request.
// - Wrong e-mail and wrong password give the same answer, after the same bcrypt work (an unknown address is compared against
//   the real hash too).
// - Lockout: 5 failures in 15 minutes per e-mail and per IP address → 429 «locked» until the oldest failure is 15 minutes old.
//   Kept in this function instance's memory and in a signed cookie in the browser (Path=/api/admin). Vercel runs several
//   instances that are started and stopped as it likes, so this is BEST-EFFORT: an attacker who drops the cookie and hits a
//   new instance gets new tries. The password (32 random characters, bcrypt cost 12) is what really protects the page.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

import bcrypt from 'bcryptjs';

export const SESSION_COOKIE = '__Host-od_admin';
export const TRIES_COOKIE = 'od_admin_tries';
export const SESSION_DAYS = 30;
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
export const MAX_FAILURES = 5;
export const LOCK_WINDOW_MS = 15 * 60 * 1000;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

/** The signing key: the session secret bound to the current password hash (a new password = every old session invalid). */
function signingKey(env) {
  const secret = String(env.ADMIN_SESSION_SECRET ?? '');
  const hash = String(env.ADMIN_PASSWORD_HASH ?? '');
  return createHash('sha256').update(`${secret}\u0000${hash}`).digest();
}
const sign = (data, env) => createHmac('sha256', signingKey(env)).update(data).digest('base64url');

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function cookiesOf(request) {
  const out = {};
  for (const part of String(request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** The session cookie's value for an address, valid SESSION_SECONDS from now. */
export function sessionValue(email, env, now = Date.now()) {
  const data = `v1.${b64(email)}.${Math.floor(now / 1000) + SESSION_SECONDS}`;
  return `${data}.${sign(data, env)}`;
}

/** The Set-Cookie header that signs in for 30 days. */
export const sessionCookie = (email, env, now = Date.now()) =>
  `${SESSION_COOKIE}=${sessionValue(email, env, now)}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;

/** The Set-Cookie header that signs out. */
export const clearSessionCookie = () => `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;

/** The address in a valid, unexpired session cookie, else null. */
export function sessionEmail(request, env, now = Date.now()) {
  const value = cookiesOf(request)[SESSION_COOKIE];
  if (!value || !env.ADMIN_SESSION_SECRET || !env.ADMIN_PASSWORD_HASH) return null;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const data = parts.slice(0, 3).join('.');
  if (!sameText(sign(data, env), parts[3])) return null;
  const expires = Number(parts[2]);
  if (!Number.isFinite(expires) || expires * 1000 <= now) return null;
  try {
    return unb64(parts[1]);
  } catch {
    return null;
  }
}

/** Whether the password matches ADMIN_PASSWORD_HASH and the address is on the list. The bcrypt work is always done
 *  against the real hash, also for an address that is not on the list, so both failures take the same time. */
export async function passwordMatches(password, known, env) {
  let ok = false;
  try {
    ok = await bcrypt.compare(String(password ?? ''), String(env.ADMIN_PASSWORD_HASH ?? ''));
  } catch {
    ok = false;
  }
  return known === true && ok === true;
}

// ── Lockout ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const memory = new Map(); // key → failure times (ms)
const MEMORY_MAX = 5000;

const recent = (times, now) => times.filter((t) => now - t < LOCK_WINDOW_MS);

/** The client's IP address as Vercel gives it (the first in x-forwarded-for), else ''. */
export function clientIp(request) {
  return String(request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? '').split(',')[0].trim();
}

/** The browser's own failure times from the signed tries cookie ([] when missing or tampered with). */
function cookieTries(request, env, now) {
  const value = cookiesOf(request)[TRIES_COOKIE];
  if (!value) return [];
  const i = value.lastIndexOf('.');
  if (i < 0 || !sameText(sign(`tries.${value.slice(0, i)}`, env), value.slice(i + 1))) return [];
  return recent(value.slice(0, i).split('-').map(Number).filter(Number.isFinite), now);
}

export function triesCookie(times, env) {
  if (!times.length) return `${TRIES_COOKIE}=; Max-Age=0; Path=/api/admin; HttpOnly; Secure; SameSite=Strict`;
  const data = times.join('-');
  return `${TRIES_COOKIE}=${data}.${sign(`tries.${data}`, env)}; Max-Age=${LOCK_WINDOW_MS / 1000}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict`;
}

const keysFor = (email, ip) => [`e:${email}`, ...(ip ? [`ip:${ip}`] : [])];

/** Whether this e-mail, this IP or this browser has MAX_FAILURES failures in the last 15 minutes. */
export function locked(request, email, env, now = Date.now()) {
  const lists = [...keysFor(email, clientIp(request)).map((k) => recent(memory.get(k) ?? [], now)), cookieTries(request, env, now)];
  return lists.some((l) => l.length >= MAX_FAILURES);
}

/** Records a failure; gives the tries cookie to send back. */
export function recordFailure(request, email, env, now = Date.now()) {
  for (const k of keysFor(email, clientIp(request))) memory.set(k, [...recent(memory.get(k) ?? [], now), now]);
  if (memory.size > MEMORY_MAX) {
    for (const [k, v] of memory) if (!recent(v, now).length) memory.delete(k);
    while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
  }
  return triesCookie([...cookieTries(request, env, now), now].slice(-MAX_FAILURES), env);
}

/** After a successful sign-in: this e-mail's and IP's failures are forgotten; gives the cookie that clears the browser's. */
export function clearFailures(request, email, env) {
  for (const k of keysFor(email, clientIp(request))) memory.delete(k);
  return triesCookie([], env);
}

/** Only for the tests. */
export const resetLockout = () => memory.clear();

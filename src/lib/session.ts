import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverSecret } from './crypto';

/** Optional APP_PASSWORD gate. The proxy runs on Node.js, so it shares this module. */
export const SESSION_COOKIE = 'evailbox_session';
const SESSION_DAYS = 30;

export function passwordProtected() {
  return !!process.env.APP_PASSWORD;
}

// Keyed by the random server secret, so a stolen cookie cannot be brute-forced offline into
// the password. Changing APP_PASSWORD or the secret invalidates every session.
function mac(purpose: string, value: string) {
  const key = createHmac('sha256', serverSecret())
    .update(`session-key:${process.env.APP_PASSWORD}`)
    .digest();
  return createHmac('sha256', key).update(`${purpose}:${value}`).digest();
}

function equal(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSessionToken(now = Date.now()) {
  const expires = String(now + SESSION_DAYS * 86_400_000);
  return {
    token: `${expires}.${mac('session', expires).toString('base64url')}`,
    maxAge: SESSION_DAYS * 86_400,
  };
}

export function verifySessionToken(token: string | undefined, now = Date.now()) {
  if (!passwordProtected()) return true;
  const [expires, signature, ...extra] = token?.split('.') ?? [];
  if (!expires || !signature || extra.length || !/^\d+$/.test(expires) || Number(expires) < now)
    return false;
  return equal(Buffer.from(signature, 'base64url'), mac('session', expires));
}

export function checkPassword(candidate: string) {
  // Equal-length MACs so neither length nor content leaks through timing.
  return equal(mac('password', candidate), mac('password', process.env.APP_PASSWORD ?? ''));
}

// ponytail: one in-memory counter for the whole instance (single owner; per-IP buckets are
// spoofable behind proxies). A stranger's guessing can delay new sign-ins by up to 15 minutes,
// but existing sessions keep working and restarting the server clears the counter.
const failures = { count: 0, until: 0 };
/** Seconds until another password attempt is allowed; 0 when allowed. */
export function loginWait(now = Date.now()) {
  return Math.max(0, Math.ceil((failures.until - now) / 1000));
}
export function recordLogin(success: boolean, now = Date.now()) {
  if (success) {
    failures.count = 0;
    failures.until = 0;
    return;
  }
  failures.count++;
  // Five free attempts, then 1s, 2s, 4s… capped at 15 minutes; no reset without a success.
  if (failures.count > 5)
    failures.until = now + Math.min(900_000, 1000 * 2 ** (failures.count - 6));
}

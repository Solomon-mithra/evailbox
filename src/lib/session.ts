/** Optional APP_PASSWORD gate. Web Crypto only, so the proxy and route handlers share it. */
export const SESSION_COOKIE = 'evailbox_session';
const SESSION_DAYS = 30;

export function passwordProtected() {
  return !!process.env.APP_PASSWORD;
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(process.env.APP_PASSWORD!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`session:${value}`));
  return Buffer.from(mac).toString('base64url');
}

function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Changing APP_PASSWORD invalidates every existing session. */
export async function createSessionToken(now = Date.now()) {
  const expires = String(now + SESSION_DAYS * 86_400_000);
  return { token: `${expires}.${await sign(expires)}`, maxAge: SESSION_DAYS * 86_400 };
}

export async function verifySessionToken(token: string | undefined, now = Date.now()) {
  if (!passwordProtected()) return true;
  const [expires, mac, ...extra] = token?.split('.') ?? [];
  if (!expires || !mac || extra.length || !/^\d+$/.test(expires) || Number(expires) < now)
    return false;
  return equal(mac, await sign(expires));
}

export async function checkPassword(candidate: string) {
  // Compare MACs so length and content do not leak through timing.
  return equal(await sign(`pw:${candidate}`), await sign(`pw:${process.env.APP_PASSWORD}`));
}

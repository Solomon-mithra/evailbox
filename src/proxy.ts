import { NextResponse, type NextRequest } from 'next/server';
import { allowedHost, unlockedPublicInstance } from '@/lib/env';
import { SESSION_COOKIE, passwordProtected, verifySessionToken } from '@/lib/session';
const publicAssets = new Set([
  '/brands/gmail.svg',
  '/brands/outlook.svg',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
]);
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!allowedHost(request.headers.get('host')))
    return new NextResponse(
      'Unknown host. Set NEXT_PUBLIC_APP_URL to the address you use to open evailbox.',
      { status: 421 },
    );
  if (unlockedPublicInstance())
    return new NextResponse(
      'Set APP_PASSWORD (or ALLOW_NO_PASSWORD=1) before serving evailbox on a non-local address.',
      { status: 503 },
    );
  // API handlers verify the session themselves and return JSON errors instead of redirects.
  if (publicAssets.has(path) || path.startsWith('/api/')) return NextResponse.next();
  if (process.env.APP_MODE === 'demo' || !passwordProtected())
    return path === '/signin'
      ? NextResponse.redirect(new URL('/inbox', request.url))
      : NextResponse.next();
  const signedIn = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!signedIn && path !== '/signin')
    return NextResponse.redirect(new URL('/signin', request.url));
  if (signedIn && path === '/signin') return NextResponse.redirect(new URL('/inbox', request.url));
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'] };

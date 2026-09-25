import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
const publicAssets = new Set([
  '/brands/gmail.svg',
  '/brands/outlook.svg',
  '/robots.txt',
  '/sitemap.xml',
  '/llms.txt',
  '/index.md',
  '/manifest.webmanifest',
  '/og/evailbox.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
]);
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // API handlers independently verify auth; avoid a second auth network round-trip.
  if (publicAssets.has(path) || path === '/pricing' || path.startsWith('/api/')) {
    return NextResponse.next();
  }
  if (path === '/') {
    // Keep bookmarks and previously delivered email links pointing at the inbox.
    if (
      request.nextUrl.searchParams.has('email') ||
      request.nextUrl.searchParams.has('workspace')
    ) {
      const inbox = request.nextUrl.clone();
      inbox.pathname = '/inbox';
      return NextResponse.redirect(inbox);
    }
    return NextResponse.next();
  }
  if (process.env.APP_MODE === 'demo') return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const publicRoute =
    path === '/signin' ||
    path === '/callback' ||
    path === '/unsubscribe' ||
    path.startsWith('/api/');
  if (!user && !publicRoute) {
    const redirect = NextResponse.redirect(new URL('/signin', request.url));
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  if (user && path === '/signin') {
    const redirect = NextResponse.redirect(new URL('/inbox', request.url));
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|icon.svg).*)'] };

import { NextResponse } from 'next/server';
import type { NextRequest, NextFetchEvent } from 'next/server';

/**
 * Analytics beacon. Only fires when an Umami endpoint is configured — on
 * Vercel leave `UMAMI_URL` unset and this middleware is a single pass-through
 * (zero network I/O). In the Docker Compose stack set it to the service,
 * e.g. `UMAMI_URL=http://umami-umami-1:3000`.
 */
const UMAMI_URL = process.env.UMAMI_URL || '';
const UMAMI_WEBSITE_ID = process.env.UMAMI_WEBSITE_ID || 'cd8f216c-fc3f-45f5-ba1a-e10309a61d18';

export function middleware(request: NextRequest, event: NextFetchEvent) {
  if (UMAMI_URL) {
    const url = request.nextUrl.pathname;

    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '127.0.0.1';
    const userAgent = request.headers.get('user-agent') || 'Unknown MSIS Client';

    const basePayload = {
      hostname: request.nextUrl.hostname,
      language: "en-US",
      referrer: request.headers.get('referer') || "",
      screen: "1920x1080",
      title: "MSIS",
      url: url,
      website: UMAMI_WEBSITE_ID,
    };

    const pageView = fetch(`${UMAMI_URL}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent, 'x-forwarded-for': ip },
      body: JSON.stringify({ payload: basePayload, type: "event" }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});

    const ipEvent = fetch(`${UMAMI_URL}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent, 'x-forwarded-for': ip },
      body: JSON.stringify({
        payload: { ...basePayload, name: "Network Log", data: { IP: ip } },
        type: "event"
      }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});

    event.waitUntil(Promise.all([pageView, ipEvent]));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

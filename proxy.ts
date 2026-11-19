import { NextRequest, NextResponse } from 'next/server';

function resolveApiOrigin(): string {
  const configuredApi = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';
  try {
    if (configuredApi.startsWith('http://') || configuredApi.startsWith('https://')) {
      return new URL(configuredApi).origin;
    }
  } catch {
    return '';
  }
  return '';
}

export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  const apiOrigin = resolveApiOrigin();
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const cspDirectives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*${apiOrigin ? ` ${apiOrigin}` : ''}`,
    `connect-src 'self' https: http://localhost:* http://127.0.0.1:*${isDev ? ' ws: wss:' : ''}${apiOrigin ? ` ${apiOrigin}` : ''}`,
  ];
  const cspHeaderValue = cspDirectives.join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeaderValue);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set('Content-Security-Policy', cspHeaderValue);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|opengraph-image).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

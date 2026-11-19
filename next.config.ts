import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  output: process.env.NEXT_OUTPUT_STANDALONE === '1' ? 'standalone' : undefined,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }],
  },
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';
    const configuredApi = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';
    let apiOrigin = '';
    try {
      if (configuredApi.startsWith('http://') || configuredApi.startsWith('https://')) {
        apiOrigin = new URL(configuredApi).origin;
      }
    } catch {
      apiOrigin = '';
    }
    const cspDirectives = [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      `img-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*${apiOrigin ? ` ${apiOrigin}` : ''}`,
      `connect-src 'self' https: http://localhost:* http://127.0.0.1:*${isProd ? '' : ' ws: wss:'}${apiOrigin ? ` ${apiOrigin}` : ''}`,
    ];
    return [
      {
        source: '/:path*',
        headers: [
          ...(isProd
            ? [
                { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
                { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
              ]
            : []),
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          { key: 'Content-Security-Policy', value: cspDirectives.join('; ') },
        ],
      },
    ];
  },
};

export default nextConfig;

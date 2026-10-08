import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      // ADR-0023 / Owner decision I2: the invitation page sends no Referer at
      // all, as defence in depth for the token in its URL fragment (which
      // browsers never put in a Referer anyway). Listed after the catch-all
      // so this value wins for /invite. No-store caching for the page comes
      // from rendering it dynamically (src/app/(auth)/invite/page.tsx).
      {
        source: '/invite',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};

export default nextConfig;

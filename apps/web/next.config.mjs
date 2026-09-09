/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@campusos/shared'],
  async rewrites() {
    // Same-origin API access in development: the web app proxies /api/* to
    // the NestJS server so the browser never needs a second origin.
    const apiBase = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

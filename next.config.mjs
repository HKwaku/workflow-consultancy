import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  async redirects() {
    return [
      {
        source: '/dashboard',
        destination: '/portal',
        permanent: true,
      },
    ];
  },
  async headers() {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const allowOrigin = process.env.NODE_ENV === 'production' && appUrl ? appUrl.replace(/\/$/, '') : (appUrl ? appUrl.replace(/\/$/, '') : 'http://localhost:3000');
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: allowOrigin },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT' },
          { key: 'Access-Control-Allow-Headers', value: 'Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key' },
        ],
      },
    ];
  },
};

export default nextConfig;

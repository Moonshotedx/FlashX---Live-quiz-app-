import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
  webpack: (config) => {
    config.resolve.alias['@'] = rootDir;
    return config;
  },
};

export default nextConfig;

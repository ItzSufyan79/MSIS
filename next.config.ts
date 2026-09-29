import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output is for the Docker image only — Vercel has its own
  // serverless build path (and standalone's extra packaging pass is pure
  // waste / a hang risk on their free-tier builders).
  output: process.env.VERCEL ? undefined : 'standalone',
  serverExternalPackages: ['ws'],
  transpilePackages: ['maplibre-gl'],
  // Type errors block the build again. They were suppressed while 17 stood
  // unfixed; those are cleared, so the gate can do its job — the AstraPanel
  // crash (createPortal used without an import) shipped precisely because
  // nothing stopped it.
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  webpack(config, { webpack }) {
    // satellite.js v7 re-exports a Node-only wasm runtime that imports
    // `node:worker_threads` / `node:module`. Webpack's client compiler cannot
    // read those schemes. The browser path only needs the pure-JS SGP4 math,
    // so swap the wasm subtree for a neutral stub.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /satellite\.js\/dist\/wasm\//,
        path.join(process.cwd(), 'vendor', 'wasm-stub.js'),
      ),
    );
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: wss: data: blob:;" },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ];
  },
};

export default nextConfig;
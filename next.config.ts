import type {NextConfig} from 'next';
import {
  SECURITY_HEADERS_LIST,
  WASM_AND_WORKER_MIME_HEADERS,
} from './lib/security/security-controls';

const isStaticExport = process.env.NEXT_OUTPUT_MODE === 'export';
const enableCoopCoep = process.env.NEXT_PUBLIC_ENABLE_COOP_COEP === 'true';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Dual-mode image configuration: unoptimized when building static export (out/), optimized on server/edge hosts.
  images: {
    unoptimized: isStaticExport,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  output: isStaticExport ? 'export' : 'standalone',
  transpilePackages: ['motion'],
  ...(isStaticExport
    ? {}
    : {
        async headers() {
          const baseHeaders: { key: string; value: string }[] =
            SECURITY_HEADERS_LIST.map((h) => ({ key: h.key, value: h.value }));
          if (enableCoopCoep) {
            const coopIdx = baseHeaders.findIndex(
              (h) => h.key === 'Cross-Origin-Opener-Policy'
            );
            if (coopIdx >= 0) {
              baseHeaders[coopIdx] = {
                key: 'Cross-Origin-Opener-Policy',
                value: 'same-origin',
              };
            }
            baseHeaders.push({
              key: 'Cross-Origin-Embedder-Policy',
              value: 'credentialless',
            });
          }

          return [
            ...WASM_AND_WORKER_MIME_HEADERS.map((rule) => ({
              source: rule.source,
              headers: rule.headers.map((h) => ({ key: h.key, value: h.value })),
            })),
            {
              source: '/:path*',
              headers: baseHeaders,
            },
          ];
        },
      }),
  webpack: (config, {dev}) => {
    // Enable WebAssembly async module support for .wasm assets
    config.experiments = {
      ...(config.experiments || {}),
      asyncWebAssembly: true,
      layers: true,
    };

    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;



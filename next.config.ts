import analyzer from '@next/bundle-analyzer';
import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';
import ReactComponentName from 'react-scan/react-component-name/webpack';

const isProd = process.env.NODE_ENV === 'production';
const buildWithDocker = process.env.DOCKER === 'true';
const isDesktop = process.env.NEXT_PUBLIC_IS_DESKTOP_APP === '1';
const enableReactScan = !!process.env.REACT_SCAN_MONITOR_API_KEY;
const isUsePglite = process.env.NEXT_PUBLIC_CLIENT_DB === 'pglite';
const shouldUseCSP = process.env.ENABLED_CSP === '1';
const uploadSourceMaps = process.env.UPLOAD_SOURCEMAPS === '1';

// if you need to proxy the api endpoint to remote server

const isStandaloneMode = buildWithDocker || isDesktop;

const standaloneConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingIncludes: { '*': ['public/**/*', '.next/static/**/*'] },
};

const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX;

const nextConfig: NextConfig = {
  ...(isStandaloneMode ? standaloneConfig : {}),
  assetPrefix,
  compiler: {
    emotion: true,
  },
  compress: isProd,
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    optimizePackageImports: [
      'emoji-mart',
      '@emoji-mart/react',
      '@emoji-mart/data',
      '@icons-pack/react-simple-icons',
      '@lobehub/ui',
      '@lobehub/icons',
      '@ant-design/icons',
      'lucide-react',
      'gpt-tokenizer',
      'antd',
      'antd-style',
      'posthog-js',
      'react-layout-kit',
      'react-i18next',
      // Added for performance optimization — Feb 2026
      'framer-motion',
      'lodash-es',
      'ahooks',
      'dayjs',
      'react-hotkeys-hook',
      '@clerk/nextjs',
      'nuqs',
      'superjson',
      '@trpc/client',
      // Added for bundle optimization — Mar 2026
      'date-fns',
      'zustand',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      'i18next',
      'zod',
      'query-string',
      // Round 2 — shiki ecosystem + antd internals
      'shiki',
      '@shikijs/core',
      '@shikijs/transformers',
      'rc-picker',
      'rc-table',
      'rc-tree',
      'rc-select',
      'rc-cascader',
      'rc-field-form',
      'rc-util',
      'rc-menu',
      '@ant-design/cssinjs',
      '@ant-design/icons-svg',
    ],
    // oidc provider depend on constructor.name
    // but swc minification will remove the name
    // so we need to disable it
    // refs: https://github.com/lobehub/lobe-chat/pull/7430
    serverMinification: false,
    webVitalsAttribution: ['CLS', 'LCP'],
    webpackMemoryOptimizations: true,
  },

  async headers() {
    const securityHeaders = [
      {
        key: 'x-robots-tag',
        value: 'all',
      },
      {
        key: 'X-Frame-Options',
        value: 'DENY',
      },
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
      {
        key: 'X-XSS-Protection',
        value: '0',
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
    ];

    if (shouldUseCSP) {
      securityHeaders.push({
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://clerk.pho.chat https://cdn.clerk.com https://www.googletagmanager.com https://va.vercel-scripts.com",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "connect-src 'self' https://clerk.pho.chat https://cdn.clerk.com https://*.clerk.accounts.dev wss:",
          "frame-src 'self' https://clerk.pho.chat https://challenges.cloudflare.com",
          "frame-ancestors 'none'",
        ].join('; '),
      });
    }

    return [
      {
        headers: securityHeaders,
        source: '/:path*',
      },
      {
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
        source: '/icons/(.*).(png|jpe?g|gif|svg|ico|webp)',
      },
      {
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'Vercel-CDN-Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
        source: '/images/(.*).(png|jpe?g|gif|svg|ico|webp)',
      },
      {
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'Vercel-CDN-Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
        source: '/videos/(.*).(mp4|webm|ogg|avi|mov|wmv|flv|mkv)',
      },
      {
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'Vercel-CDN-Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
        source: '/screenshots/(.*).(png|jpe?g|gif|svg|ico|webp)',
      },
      {
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'Vercel-CDN-Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
        source: '/og/(.*).(png|jpe?g|gif|svg|ico|webp)',
      },
      {
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
        source: '/favicon.ico',
      },
      {
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
        source: '/favicon-32x32.ico',
      },
      {
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
        source: '/apple-touch-icon.png',
      },
    ];
  },

  // Image optimization – prefer WebP for smaller payloads
  images: {
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 31_536_000, // 1 year
  },

  logging: {
    fetches: {
      fullUrl: true,
      hmrRefreshes: true,
    },
  },

  // Exclude unnecessary files from serverless function bundles to reduce size
  // Moved from experimental to top-level in Next.js 15
  outputFileTracingExcludes: {
    '*': [
      'node_modules/@swc/core-linux-x64-gnu',
      'node_modules/@swc/core-linux-x64-musl',
      'node_modules/@esbuild/linux-x64',
      'node_modules/webpack',
      'node_modules/rollup',
      'node_modules/terser',
    ],
  },

  reactStrictMode: true,
  redirects: async () => [
    {
      destination: '/sitemap-index.xml',
      permanent: true,
      source: '/sitemap.xml',
    },
    // ... existing redirects
    {
      destination: '/sitemap-index.xml',
      permanent: true,
      source: '/sitemap-0.xml',
    },
    {
      destination: '/sitemap/plugins-1.xml',
      permanent: true,
      source: '/sitemap/plugins.xml',
    },
    {
      destination: '/sitemap/assistants-1.xml',
      permanent: true,
      source: '/sitemap/assistants.xml',
    },
    {
      destination: '/manifest.webmanifest',
      permanent: true,
      source: '/manifest.json',
    },
    {
      destination: '/discover/assistant',
      permanent: true,
      source: '/discover/assistants',
    },
    {
      destination: '/discover/plugin',
      permanent: true,
      source: '/discover/plugins',
    },
    {
      destination: '/discover/model',
      permanent: true,
      source: '/discover/models',
    },
    {
      destination: '/discover/provider',
      permanent: true,
      source: '/discover/providers',
    },
    // {
    //   destination: '/settings/common',
    //   permanent: true,
    //   source: '/settings',
    // },
    {
      destination: '/chat',
      permanent: true,
      source: '/welcome',
    },
    // TODO: 等 V2 做强制跳转吧
    // {
    //   destination: '/settings/provider/volcengine',
    //   permanent: true,
    //   source: '/settings/provider/doubao',
    // },
    // we need back /repos url in the further
    {
      destination: '/files',
      permanent: false,
      source: '/repos',
    },
  ],

  rewrites: async () => [
    {
      destination: 'https://us.i.posthog.com/:path*',
      source: '/ingest/:path*',
    },
    {
      destination: 'https://us.i.posthog.com/static/:path*',
      source: '/ingest/static/:path*',
    },
  ],

  // when external packages in dev mode with turbopack, this config will lead to bundle error
  // For production we also externalize large server-only SDKs to keep individual
  // Serverless Function bundles smaller (the packages are still present in
  // node_modules at runtime on Vercel).
  serverExternalPackages: isProd
    ? [
        '@electric-sql/pglite',
        '@xmldom/xmldom',
        '@aws-sdk/client-s3',
        '@aws-sdk/s3-request-presigner',
        'sharp',
        '@img/sharp-libvips-linux-x64',
        '@img/sharp-libvips-linuxmusl-x64',
        '@shikijs/langs',
        '@shikijs/themes',
        '@shikijs/engine-oniguruma',
        'pdf-parse',
        // epub2 depends on native 'zipfile' module which can't be bundled by webpack
        'epub2',
      ]
    : ['@xmldom/xmldom', 'epub2'],

  transpilePackages: ['pdfjs-dist'],
  typescript: {
    ignoreBuildErrors: true,
  },

  // Generate hidden source maps for PostHog error tracking (no sourceMappingURL in JS files)
  ...(uploadSourceMaps ? { productionBrowserSourceMaps: true } : {}),

  webpack(config, { isServer }) {
    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    };

    // Use hidden-source-map so .map files are generated but never referenced in JS output
    if (uploadSourceMaps && !isServer) {
      config.devtool = 'hidden-source-map';
    }

    // 开启该插件会导致 pglite 的 fs bundler 被改表
    if (enableReactScan && !isUsePglite) {
      config.plugins.push(ReactComponentName({}));
    }

    // to fix shikiji compile error
    // refs: https://github.com/antfu/shikiji/issues/23
    config.module.rules.push({
      resolve: {
        fullySpecified: false,
      },
      test: /\.m?js$/,
      type: 'javascript/auto',
    });

    // https://github.com/pinojs/pino/issues/688#issuecomment-637763276
    config.externals.push('pino-pretty');

    const webpack = require('webpack');

    // Exclude mermaid from client bundle (~2.4MB savings)
    // @lobehub/ui's useMermaid hook does import('mermaid') which webpack pre-bundles
    // the entire mermaid + d3 + dagre dependency tree.
    // The hook handles null gracefully (falls back to raw content).
    // Mermaid diagrams are rendered via CDN in the visualizer iframe.
    if (!isServer) {
      const emptyMod = require.resolve('./auto/bundle/empty-module.js');

      // Exclude heavy transitive deps from client bundle:
      // 1. mermaid: @lobehub/ui's useMermaid hook does import('mermaid') pulling entire mermaid+d3+dagre.
      //    The hook handles null gracefully. Mermaid diagrams rendered via CDN in visualizer iframe.
      // 2. emoji-mart: @lobehub/ui's EmojiPicker statically imports @emoji-mart/data and @emoji-mart/react
      //    but Phở Chat doesn't use EmojiPicker directly. Prevents ~500KB+ of emoji catalog data.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^mermaid$/, emptyMod),
        new webpack.NormalModuleReplacementPlugin(/^@emoji-mart\/data/, emptyMod),
        new webpack.NormalModuleReplacementPlugin(/^@emoji-mart\/react/, emptyMod),
        new webpack.NormalModuleReplacementPlugin(/^emoji-mart$/, emptyMod),
      );
    }

    config.resolve.alias.canvas = false;

    // Fix SWR react-server export condition stripping useSWR/mutate
    //
    // Problem: SWR v2's package.json "react-server" export condition resolves to
    // react-server.mjs containing only SWRConfig + unstable_serialize — NOT useSWR
    // or mutate. Next.js RSC compilation uses this condition, causing build errors.
    //
    // Solution: Custom resolve plugin that hooks into the 'result' stage (AFTER full
    // resolution including package.json exports). When the resolved path ends with
    // react-server.mjs from SWR, we swap it to the full client entry (index.mjs).
    config.resolve.plugins = config.resolve.plugins || [];
    config.resolve.plugins.push({
      apply(resolver: any) {
        resolver
          .getHook('result')
          .tapAsync('SwrReactServerFix', (request: any, resolveContext: any, callback: any) => {
            const resolvedPath = request.path;
            if (
              resolvedPath &&
              /[/\\]swr[/\\]dist[/\\](index|_internal|infinite)[/\\]react-server\.mjs$/.test(
                resolvedPath,
              )
            ) {
              const newPath = resolvedPath.replace('react-server.mjs', 'index.mjs');
              const newRequest = { ...request, path: newPath };
              return callback(null, newRequest);
            }
            return callback(null, request);
          });
      },
    });

    // pptxgenjs ESM bundle uses dynamic import('node:fs'), import('node:https')
    // which cause UnhandledSchemeError in webpack client builds.
    // NormalModuleReplacementPlugin handles static require/import but NOT dynamic import().
    // We must also alias node:-prefixed modules so webpack resolves them to false.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: any) => {
        resource.request = resource.request.replace(/^node:/, '');
      }),
    );

    // to ignore epub2 compile error
    // refs: https://github.com/lobehub/lobe-chat/discussions/6769
    // Stub Node.js built-ins for client builds (pptxgenjs, epub2, etc.)
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      http: false,
      https: false,
      stream: false,
      zipfile: false,
      zlib: false,
    };

    if (assetPrefix && (assetPrefix.startsWith('http://') || assetPrefix.startsWith('https://'))) {
      // fix the Worker URL cross-origin issue
      // refs: https://github.com/lobehub/lobe-chat/pull/9624
      config.module.rules.push({
        generator: {
          // @see https://webpack.js.org/configuration/module/#rulegeneratorpublicpath
          publicPath: '/_next/',
        },
        test: /worker\.ts$/,
        // @see https://webpack.js.org/guides/asset-modules/
        type: 'asset/resource',
      });
    }

    return config;
  },
};

const noWrapper = (config: NextConfig) => config;

const withBundleAnalyzer = process.env.ANALYZE === 'true' ? analyzer() : noWrapper;

const withPWA =
  isProd && !isDesktop
    ? withSerwistInit({
        // Allow precaching of large PGLite assets for offline functionality
        // Reduced from 10MB to 5MB to optimize build memory usage on Vercel
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,

        register: false,

        swDest: 'public/sw.js',

        swSrc: 'src/app/sw.ts', // 5MB
      })
    : noWrapper;

// Conditionally wrap with Sentry based on environment variable
// NOTE: Sentry has been fully removed for performance optimization
// The entire @sentry/nextjs package was adding ~200KB+ to the client bundle
// and causing ~8s of main thread blocking time on the /chat page

export default withBundleAnalyzer(withPWA(nextConfig as NextConfig));

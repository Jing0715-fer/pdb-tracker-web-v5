import type { NextConfig } from "next";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname_val = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

const localRequire = createRequire(import.meta.url);

const isDev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ["molstar"],
  // Next.js 16 dev mode blocks cross-origin HMR by default. The preview
  // panel and Playwright headless chromium see 127.0.0.1:3000 as cross-origin.
  // Include both the bare domain and the preview-chat subdomain pattern.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '.space-z.ai', 'preview-chat-*.space-z.ai'],
  // Optimize barrel imports for heavy libraries so the bundler only resolves
  // the actually-used symbols instead of the entire barrel graph. This is
  // the single biggest dev-mode memory win for apps that pull from large
  // barrel-export libraries (recharts, framer-motion, radix).
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'framer-motion',
      '@radix-ui/react-icons',
      'date-fns',
      'react-markdown',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-tabs',
      '@radix-ui/react-select',
      '@radix-ui/react-popover',
      '@radix-ui/react-scroll-area',
      'zod',
      'clsx',
      'tailwind-merge',
    ],
  },
  // File watcher options — prevents HMR from triggering when the SQLite DB
  // file (db/custom.db) is written to by API routes (e.g. run center jobs,
  // PDB weekly fetch, seed-demo). Without this, every DB write triggers a
  // full page reload in dev mode.
  // Round 49: Ignore SQLite database files (including WAL/journal) + other
  // runtime-generated files to prevent HMR from triggering page reloads
  // when API routes write to the database.
  watchOptions: {
    ignored: [
      '**/db/**',
      '**/*.db',
      '**/*.db-journal',
      '**/*.db-wal',
      '**/*.db-shm',
      '**/dev.log',
      '**/dev.out.log',
      '**/.hermes/**',
      '**/tool-results/**',
      '**/wiki/**',
      '**/download/**',
      '**/upload/**',
      '**/.zscripts/**',
      '**/worklog.md',
    ],
  },
  // Webpack config — used when `next dev --webpack` or `next build` is run.
  // We keep webpack (not Turbopack) because the project relies on
  // serverExternalPackages + snapshot tuning that webpack supports natively.
  webpack: (config, { dev }) => {
    // ── OOM mitigation (4GB / no-swap sandboxes) ─────────────────────────
    // molstar (~95 MB of TypeScript source) is the #1 cause of dev-mode
    // OOM kills. Even though it's loaded via dynamic import, webpack still
    // traces its package.json exports on first compile. In dev we use
    // IgnorePlugin to completely skip molstar's TS/JS source — the 3D
    // viewer shows a placeholder in dev and works normally in production.
    if (dev) {
      // Obtain the webpack instance that Next.js bundles. Using createRequire
      // avoids ESM/CJS interop issues with a top-level `import webpack`.
      const webpack = localRequire('webpack');
      config.plugins = config.plugins || [];
      // IgnorePlugin with a contextRegExp matches any `import('molstar/...')`
      // deep path (not just the bare `import 'molstar'`). This completely
      // removes molstar's 95MB of TS source from the dev compile graph.
      // The 3D viewer shows a placeholder in dev; production builds are
      // unaffected (IgnorePlugin only runs in the `dev` branch).
      config.plugins.push(new webpack.IgnorePlugin({
        resourceRegExp: /^molstar(\/|$)/,
      }));
    }

    config.parallelism = 1;
    config.infrastructureLogging = Object.assign(config.infrastructureLogging || {}, {
      level: 'warn',
    });

    // Note: ChunkLoadError retry is handled in layout.tsx via a <script> tag
    // that patches __webpack_require__.e at runtime. This is more reliable
    // than the webpack entry approach (which had issues with data: URLs).

    if (dev) {
      const root = resolve(__dirname_val);
      const ignored = [
        resolve(root, '.hermes'),
        resolve(root, 'dev.log'),
        resolve(root, 'dev.out.log'),
        resolve(root, 'db'),
        resolve(root, 'wiki'),
        resolve(root, 'tool-results'),
        resolve(root, '.bun'),
      ];
      config.snapshot = config.snapshot || {};
      config.snapshot.managedPaths = (config.snapshot.managedPaths || []).concat(ignored);
      config.snapshot.immutablePaths = (config.snapshot.immutablePaths || []).concat(ignored);
      // Note: watchOptions.ignored is now set at the top level (see above).
      // Previously Next.js 16 froze the watchOptions object, but top-level
      // watchOptions.ignored now works correctly in 16.x for non-route files.
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "*" },
        ],
      },
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;

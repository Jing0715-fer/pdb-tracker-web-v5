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
  // Round 54: HMR fix — Next.js 16 webpack mode does NOT support watchOptions
  // (it's a Turbopack-only feature). The old `{ ignored: [...] }` and the
  // new `{ paths: { ignored: [...] } }` both produce "Unrecognized key" warnings.
  // The correct approach for webpack is config.snapshot.managedPaths in the
  // webpack config below, PLUS setting watchFiles to false for the db dir.
  // We remove the top-level watchOptions entirely and rely on the webpack
  // snapshot config + a custom watchOptions plugin.
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
      const ignoredPaths = [
        resolve(root, '.hermes'),
        resolve(root, 'dev.log'),
        resolve(root, 'dev.out.log'),
        resolve(root, 'db'),
        resolve(root, 'wiki'),
        resolve(root, 'tool-results'),
        resolve(root, '.bun'),
        resolve(root, '.zscripts'),
        resolve(root, 'worklog.md'),
      ];
      config.snapshot = config.snapshot || {};
      // managedPaths: webpack treats these as "managed" (won't trigger rebuilds)
      config.snapshot.managedPaths = (config.snapshot.managedPaths || []).concat(ignoredPaths);
      // immutablePaths: webpack caches these and never re-reads them
      config.snapshot.immutablePaths = (config.snapshot.immutablePaths || []).concat(ignoredPaths);

      // Round 54: Also directly configure the watchOptions plugin to ignore
      // db/*.db* files at the webpack level. This is the most reliable way
      // to prevent HMR from triggering when SQLite writes to the database.
      const webpack = localRequire('webpack');
      if (webpack) {
        config.plugins = config.plugins || [];
        config.plugins.push(new webpack.WatchIgnorePlugin({
          paths: [
            /node_modules\/\.prisma/,
            /db\/.*\.db/,
            /db\/.*\.db-journal/,
            /db\/.*\.db-wal/,
            /db\/.*\.db-shm/,
            /\.hermes/,
            /tool-results/,
            /molcraft-analysis/,
          ],
        }));
      }
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

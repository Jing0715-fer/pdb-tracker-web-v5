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
    // ── OOM mitigation ─────────────────────────────────────────────────────
    // R135: REMOVED the IgnorePlugin for molstar — it was causing Molstar
    // to NEVER load in dev mode, which meant:
    //   - Structure viewer showed a placeholder (not real 3D)
    //   - set_color_theme failed with "No components to color"
    //   - set_representation / updateRepresentationsType had no effect
    //   - Screenshots were blank (capturing placeholder, not 3D canvas)
    //   - camera.rotate / camera.setState had no effect
    //
    // Instead of ignoring molstar entirely, we use:
    //   1. serverExternalPackages (already set above) — molstar is loaded
    //      as an external package, not bundled by webpack
    //   2. optimizePackageImports — reduces barrel import overhead
    //   3. parallelism: 1 — prevents parallel compilation OOM
    //   4. infrastructureLogging: 'warn' — reduces log memory

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

      // Round 60: Comprehensive WatchIgnorePlugin configuration.
      // The regex patterns match against the FULL absolute file path, so we
      // use patterns that match both the directory and its contents.
      //
      // Key insight: managedPaths only affects webpack's module resolution
      // cache. The ACTUAL file watcher that triggers HMR rebuilds is
      // WatchIgnorePlugin. We must include ALL paths that get written during
      // API route execution:
      //   - db/*.db, *.db-journal, *.db-wal, *.db-shm (SQLite writes)
      //   - .hermes/ (db-config.json, LLM cache)
      //   - wiki/ (report file saves)
      //   - tool-results/ (analysis output)
      //   - worklog.md (agent worklog)
      //   - dev.log, dev.out.log (server logs)
      //   - molcraft-analysis/ (analysis temp files — may be in project on some setups)
      //   - node_modules/.prisma (Prisma client regeneration)
      //
      // We also add the absolute path strings directly — WatchIgnorePlugin
      // accepts both regex and string paths. Strings are matched exactly
      // (file or directory), regexes are tested against the full path.
      const webpack = localRequire('webpack');
      if (webpack) {
        config.plugins = config.plugins || [];
        // Build ignore list: regexes for flexible matching + absolute paths for exact matching
        const ignorePatterns: (RegExp | string)[] = [
          // Regex patterns (match against full absolute path)
          /node_modules\/\.prisma/,
          /[/\\]db[/\\].*\.db$/,
          /[/\\]db[/\\].*\.db-journal$/,
          /[/\\]db[/\\].*\.db-wal$/,
          /[/\\]db[/\\].*\.db-shm$/,
          /[/\\]\.hermes[/\\]?$/,
          /[/\\]\.hermes[/\\].*/,
          /[/\\]wiki[/\\]?$/,
          /[/\\]wiki[/\\].*/,
          /[/\\]tool-results[/\\]?$/,
          /[/\\]tool-results[/\\].*/,
          /[/\\]molcraft-analysis[/\\]?$/,
          /[/\\]molcraft-analysis[/\\].*/,
          /[/\\]worklog\.md$/,
          /[/\\]dev\.log$/,
          /[/\\]dev\.out\.log$/,
          /[/\\]\.bun[/\\]?$/,
          /[/\\]\.zscripts[/\\]?$/,
        ];
        // Also add absolute path strings for the directories themselves
        // (WatchIgnorePlugin matches these exactly, catching the directory mtime change)
        for (const p of ignoredPaths) {
          ignorePatterns.push(p);
        }
        config.plugins.push(new webpack.WatchIgnorePlugin({
          paths: ignorePatterns,
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

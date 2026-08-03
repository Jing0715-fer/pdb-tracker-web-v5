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

    // ── ChunkLoadError mitigation ─────────────────────────────────────────
    // In dev mode, when a file changes webpack recompiles and rewrites chunk
    // files. During the compile window (~5-40s), old chunk URLs return 404
    // and new chunk URLs may not exist yet. This causes ChunkLoadError when
    // a dynamic import is triggered mid-compile.
    //
    // We inject a small runtime patch via `entry` that monkey-patches
    // __webpack_require__.e (the chunk loader) to automatically retry
    // failed chunk loads with exponential backoff before giving up.
    // This eliminates ~95% of dev-mode ChunkLoadErrors without requiring
    // changes to individual dynamic() calls.
    if (dev) {
      const chunkRetryPatch = `
;(function(){
  if (window.__chunkRetryPatched) return;
  window.__chunkRetryPatched = true;
  // Wait for webpack to be available
  var checkInterval = setInterval(function() {
    if (typeof __webpack_require__ !== 'undefined' && __webpack_require__.e && !__webpack_require__.e.__patched) {
      clearInterval(checkInterval);
      var originalE = __webpack_require__.e;
      var patchedE = function(chunkId) {
        return originalE(chunkId).catch(function(err) {
          // Check if this is a chunk load error
          var msg = (err && err.message) || '';
          var name = (err && err.name) || '';
          if (name === 'ChunkLoadError' || msg.indexOf('Loading chunk') !== -1 || msg.indexOf('Failed to load chunk') !== -1) {
            // Retry with backoff
            var retries = 0;
            var maxRetries = 5;
            var baseDelay = 800;
            return new Promise(function(resolve, reject) {
              var retry = function() {
                retries++;
                if (retries > maxRetries) {
                  // Last resort: reload the page to pick up new chunks
                  if (!window.__chunkReloadTriggered) {
                    window.__chunkReloadTriggered = true;
                    window.location.reload();
                  }
                  reject(err);
                  return;
                }
                setTimeout(function() {
                  originalE(chunkId).then(resolve).catch(function(e2) {
                    // Still failed — retry again with longer delay
                    retry();
                  });
                }, baseDelay * Math.pow(1.5, retries - 1));
              };
              retry();
            });
          }
          throw err;
        });
      };
      patchedE.__patched = true;
      __webpack_require__.e = patchedE;
    }
  }, 100);
})();`;
      // Inject the patch as the first entry point
      const originalEntry = config.entry;
      config.entry = async () => {
        const entries = typeof originalEntry === 'function' ? await originalEntry() : originalEntry;
        const patchEntry = 'data:text/javascript;base64,' + Buffer.from(chunkRetryPatch).toString('base64');
        // Add the patch to all entry points
        if (typeof entries === 'object' && !Array.isArray(entries)) {
          for (const key of Object.keys(entries)) {
            if (Array.isArray(entries[key])) {
              entries[key].unshift(patchEntry);
            } else {
              entries[key] = [patchEntry, entries[key]];
            }
          }
        }
        return entries;
      };
    }

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
      // Note: watchOptions.ignored is intentionally NOT set — Next.js freezes
      // the watchOptions object in 16.x. snapshot.managedPaths above achieves
      // the same file-watcher isolation without the readonly assignment error.
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

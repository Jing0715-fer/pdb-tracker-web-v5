import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n";

// Use static generation for the HTML shell — the page is client-rendered
// (PdbTracker uses ssr:false dynamic import). force-dynamic caused OOM on
// the standalone server under concurrent requests because every request
// re-rendered the shell server-side.
export const dynamic = 'force-static';
export const revalidate = false;

// Fonts: CSS variable stubs (no Google Fonts - network unavailable)
const geistSans = { variable: "--font-geist-sans" };
const geistMono = { variable: "--font-geist-mono" };

// molstar CSS is injected client-side on demand (see PdbStructureViewer) so
// the initial server compile doesn't have to traverse the 95MB molstar graph.

export const metadata: Metadata = {
  title: "PDB Structure Tracker",
  description: "Protein Data Bank structure tracking, evaluation, and literature monitoring platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Prebuilt Molstar bundle CSS — used by the Structure Analysis module's
            3D viewer (loaded via script tag, not npm import, so it works in dev). */}
        <link rel="stylesheet" href="/molstar.css" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var hc=localStorage.getItem('pdb-high-contrast');if(hc==='true'){document.documentElement.classList.add('high-contrast');}var ct=localStorage.getItem('pdb-color-theme');if(ct){var themes={'claude':['#c96442','#a04e32'],'ocean':['#2d8f8f','#1f6b6b'],'forest':['#16a34a','#15803d'],'sunset':['#ea580c','#c2410c'],'berry':['#7c5cbf','#5a3d99'],'rose':['#e11d48','#be123c']};var t=themes[ct]||themes['claude'];var r=document.documentElement;r.style.setProperty('--claude-accent',t[0]);r.style.setProperty('--claude-accent-hover',t[1]);r.style.setProperty('--claude-accent-light',t[0]+'15');r.style.setProperty('--primary',t[0]);r.style.setProperty('--ring',t[0]);r.style.setProperty('--chart-1',t[0]);r.style.setProperty('--sidebar-primary',t[0]);r.style.setProperty('--sidebar-ring',t[0]);}}catch(e){}`,
          }}
        />
        {/* ChunkLoadError retry patch — patches __webpack_require__.e to
            automatically retry failed chunk loads with exponential backoff.
            This handles dev server recompiles where chunks are temporarily
            unavailable. Only falls back to page reload after max retries. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  if (window.__chunkRetryPatched) return;
  window.__chunkRetryPatched = true;
  var checkInterval = setInterval(function() {
    if (typeof __webpack_require__ !== 'undefined' && __webpack_require__.e && !__webpack_require__.e.__patched) {
      clearInterval(checkInterval);
      var originalE = __webpack_require__.e;
      __webpack_require__.e = function(chunkId) {
        return originalE(chunkId).catch(function(err) {
          var msg = (err && err.message) || '';
          var name = (err && err.name) || '';
          if (name === 'ChunkLoadError' || msg.indexOf('Loading chunk') !== -1 || msg.indexOf('Failed to load chunk') !== -1) {
            var retries = 0;
            var maxRetries = 8;
            var baseDelay = 500;
            return new Promise(function(resolve, reject) {
              var retry = function() {
                retries++;
                if (retries > maxRetries) {
                  if (!window.__chunkReloadTriggered) {
                    window.__chunkReloadTriggered = true;
                    window.location.reload();
                  }
                  reject(err);
                  return;
                }
                setTimeout(function() {
                  originalE(chunkId).then(resolve).catch(function() { retry(); });
                }, baseDelay * Math.pow(1.4, retries - 1));
              };
              retry();
            });
          }
          throw err;
        });
      };
      __webpack_require__.e.__patched = true;
    }
  }, 50);
})();`,
          }}
        />
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <I18nProvider>
            {children}
            <Toaster position="bottom-right" />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
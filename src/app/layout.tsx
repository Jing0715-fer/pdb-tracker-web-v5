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
import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import './tokens.css';
import './mvp.css';
import './tree-3d.css';
import AppShell from '../components/app-shell';

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('guulin-theme');if(t==='parchment'||t==='mauve'||t==='deep-purple'||t==='emerald'||t==='obsidian'){document.documentElement.setAttribute('data-theme',t);}else{document.documentElement.setAttribute('data-theme','parchment');}}catch(e){}})();`;

function resolveMetadataBase(): URL {
  const candidate =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000');
  try {
    return new URL(candidate);
  } catch {
    return new URL('http://localhost:3000');
  }
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  applicationName: 'Гуулингийнхан',
  title: {
    default: 'ГУУЛИНГИЙНХАН — Ургийн мод',
    template: '%s · ГУУЛИНГИЙНХАН',
  },
  description: 'Монгол гэр бүлийн ургийн мод, намтар, түүх, дурсамж болон хамтын өв соёлын платформ.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon.svg',
  },
  openGraph: {
    type: 'website',
    locale: 'mn_MN',
    siteName: 'Гуулингийнхан',
    title: 'ГУУЛИНГИЙНХАН — Ургийн мод',
    description: 'Монгол гэр бүлийн ургийн мод, намтар, түүх, дурсамж болон хамтын өв соёлын платформ.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ГУУЛИНГИЙНХАН — Ургийн мод',
    description: 'Монгол гэр бүлийн ургийн мод, намтар, түүх, дурсамж болон хамтын өв соёлын платформ.',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f1e5' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f19' },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="mn" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Suspense fallback={children}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}

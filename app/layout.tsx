import { Suspense } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import './tokens.css';
import './mvp.css';
import './tree-3d.css';
import AppShell from '../components/app-shell';

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('guulin-theme');if(t==='parchment'||t==='mauve'||t==='deep-purple'||t==='emerald'||t==='obsidian'){document.documentElement.setAttribute('data-theme',t);}else{document.documentElement.setAttribute('data-theme','parchment');}}catch(e){}})();`;

export const metadata: Metadata = {
  title: 'ГУУЛИНГИЙНХАН — Ургийн мод',
  description: 'Монгол гэр бүлийн ургийн мод, намтар, түүх, дурсамж.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="mn" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Suspense fallback={children}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}

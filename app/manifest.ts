import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Гуулингийнхан — Ургийн бичиг & Удмын мод',
    short_name: 'Гуулингийнхан',
    description: 'Монгол гэр бүлийн ургийн мод, намтар, дурсамж, өв соёлын дижитал платформ.',
    start_url: '/',
    display: 'standalone',
    lang: 'mn',
    background_color: '#f7f1e5',
    theme_color: '#17372b',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}

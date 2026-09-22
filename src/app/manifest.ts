import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: site.name,
    short_name: site.name,
    description: site.description,
    lang: 'en',
    start_url: '/inbox',
    scope: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#044b39',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}

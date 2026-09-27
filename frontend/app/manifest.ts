import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Trading Desk',
    short_name: 'Trading Desk',
    description: 'Real-time market dashboard with an explainable AI trade scanner.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0d12',
    theme_color: '#0a0d12',
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

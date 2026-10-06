import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // /api nie aus dem Cache und nie auf die SPA-Shell zurueckfallen.
        navigateFallbackDenylist: [/^\/api/],
      },
      manifest: {
        name: 'LiLief-Kino',
        short_name: 'Kino',
        description: 'Berliner Kinoprogramm, Abstimmung und Besuchslog',
        lang: 'de',
        display: 'standalone',
        background_color: '#faf7f2',
        theme_color: '#faf7f2',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': process.env.VITE_API_TARGET || 'http://localhost:3005',
    },
  },
})

import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        // outDir: baseOutDir,
        manifest: true,
        rollupOptions: {
            // overwrite default .html entry
            input: 'src/main.js',
        },
    },
    server: {
        origin: 'http://localhost:3000',
    },
    plugins: [
        VitePWA({
            includeAssets: ['favicon.svg', 'favicon.ico', 'robots.txt', 'apple-touch-icon.png'],
            manifest: {
                name: 'Docstore',
                short_name: 'Docstore',
                description: 'Application allowing to store files in a secure way via encryption.',
                theme_color: '#facc15',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'any maskable',
                    },
                ],
            },
        }),
    ],
})

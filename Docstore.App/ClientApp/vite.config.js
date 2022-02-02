import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// config
const baseOutDir = '../wwwroot'

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
                description: 'Application used to store files in an encrypted way',
                theme_color: '#EAB308',
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

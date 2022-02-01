import { defineConfig } from 'vite'

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
})

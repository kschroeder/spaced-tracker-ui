import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
    plugins: [vue()],
    base: command === 'build' ? '/app/' : '/',
    build: {
        outDir: '../public/app',
        emptyOutDir: true,
    },
    server: {
        host: '127.0.0.1',
        port: 5173,
        proxy: {
            '/api': 'http://127.0.0.1:8088',
        },
    },
    test: {
        environment: 'jsdom',
    },
}))

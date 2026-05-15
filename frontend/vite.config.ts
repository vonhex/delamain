import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5000,
    allowedHosts: ['delamain.genysis.xyz'],
    proxy: {
      '/ws': { target: 'ws://localhost:8888', ws: true, changeOrigin: true },
      '/api': { target: 'http://localhost:8888', changeOrigin: true },
      '/audio': { target: 'http://localhost:8888', changeOrigin: true },
      '/health': { target: 'http://localhost:8888', changeOrigin: true },
    },
  },
})

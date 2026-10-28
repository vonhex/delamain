import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev and preview servers answer only on localhost and IP addresses unless the
// hostname is listed. When one of them sits behind your own tunnel or reverse proxy,
// list its domain: DELAMAIN_ALLOWED_HOSTS=delamain.example.com (comma-separated).
// A normal install serves the page from the backend on :8888 and does not need this.
const allowedHosts = (process.env.DELAMAIN_ALLOWED_HOSTS ?? '')
  .split(',').map(h => h.trim()).filter(Boolean)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5000,
    allowedHosts,
    proxy: {
      '/ws': { target: 'ws://localhost:8888', ws: true, changeOrigin: true },
      '/api': { target: 'http://localhost:8888', changeOrigin: true },
      '/audio': { target: 'http://localhost:8888', changeOrigin: true },
      '/lines': { target: 'http://localhost:8888', changeOrigin: true },
      '/health': { target: 'http://localhost:8888', changeOrigin: true },
    },
  },
  preview: { allowedHosts },
})

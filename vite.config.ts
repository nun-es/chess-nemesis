import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api/coach': {
    target: 'http://127.0.0.1:8787', changeOrigin: true,
  }, '/chess-api': {
    target: 'https://api.chess.com', changeOrigin: true,
    rewrite: (path) => path.replace(/^\/chess-api/, '/pub'),
    configure(proxy) {
      proxy.on('proxyReq', (request) => {
        request.setHeader('User-Agent', 'ChessNemesis/0.1 (personal chess analysis)')
      })
    },
  } } },
})

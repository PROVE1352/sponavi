import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// API 베이스는 `/api`. dev에서는 FastAPI(127.0.0.1:8000)로 프록시.
// VITE_MOCK=1 이면 프론트가 목 응답을 쓰므로 프록시는 사용되지 않는다(서버 불필요).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})

/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// "글씨 크게"(헤더 토글) 지원: 화면 글자 크기 대부분이 px 임의값(text-[13.5px])이라
// 루트 font-size 만 키우면 rem 부분만 커진다. 그래서 CSS 의 `font-size: Npx` 를
// `calc(Npx * var(--fs, 1))` 로 바꿔 둔다 — 평소엔 --fs 가 없어 1배(값 동일),
// html.text-large 에서 --fs 를 올리면 px 글자도 같이 커진다(index.css). 레이아웃 px 은 건드리지 않는다.
function scalablePxFontSize(): Plugin {
  const re = /font-size:\s*(\d+(?:\.\d+)?)px/g
  return {
    name: 'sponavi:scalable-px-font-size',
    // enforce 없음(normal) = vite:css 가 CSS 를 다 만든 뒤, vite:css-post 가 JS 로 감싸기 전.
    transform(code, id) {
      if (!id.split('?')[0].endsWith('.css')) return null
      if (!re.test(code)) return null
      re.lastIndex = 0
      return { code: code.replace(re, 'font-size:calc($1px * var(--fs, 1))'), map: null }
    },
  }
}

// API 베이스는 `/api`. dev에서는 FastAPI(127.0.0.1:8000)로 프록시.
// VITE_MOCK=1 이면 프론트가 목 응답을 쓰므로 프록시는 사용되지 않는다(서버 불필요).
export default defineConfig({
  plugins: [react(), tailwindcss(), scalablePxFontSize()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  // 단위 테스트(T1A): `npm test` → vitest. 순수 함수(format/mocks 계약)만 다루므로 DOM 불필요.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

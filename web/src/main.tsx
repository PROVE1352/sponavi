import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import ChatApp from './chat/ChatApp'
import { applyTextLarge, readTextLarge } from './lib/textSize'

// 초기 테마: 시스템 선호 반영(수동 토글은 헤더에서). 라이트/다크 모두 지원.
if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
  document.documentElement.classList.add('dark')
}

// "글씨 크게"(헤더 토글) — 저장된 선택을 첫 렌더 전에 반영한다(깜빡임 방지).
applyTextLarge(readTextLarge())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatApp />
  </StrictMode>,
)

// "글씨 크게" 토글 상태(헤더). html.text-large 클래스 하나가 화면 전체 글자를 키운다(index.css).
// 저장은 이 브라우저의 localStorage 뿐이고, 막혀 있으면(사생활 보호 모드 등) 조용히 기본값으로 동작한다.
// CSP(script-src 'self') 때문에 인라인 스크립트로 선적용하지 않는다 — main.tsx 가 첫 렌더 전에 적용한다.

export const TEXT_LARGE_KEY = 'sponavi:text-large'
export const TEXT_LARGE_CLASS = 'text-large'

export function readTextLarge(): boolean {
  try {
    return window.localStorage.getItem(TEXT_LARGE_KEY) === '1'
  } catch {
    return false
  }
}

export function applyTextLarge(on: boolean): void {
  document.documentElement.classList.toggle(TEXT_LARGE_CLASS, on)
}

export function saveTextLarge(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(TEXT_LARGE_KEY, '1')
    else window.localStorage.removeItem(TEXT_LARGE_KEY)
  } catch {
    /* 저장 불가 — 이번 방문 동안만 적용된다 */
  }
}

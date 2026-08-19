// 하단 고정 컴포저: 자유 입력(항상 활성) + 보내기.
// ★ v1.6: 칩은 여기 없다 — 질문의 퀵리플라이 칩·지역 검색은 전부 해당 질문 버블 아래
//   스트림 인라인으로 옮겼다(FR-12 AC1 v1.6, 표준 채팅 문법). 컴포저에는 어떤 칩도 남지 않는다.
// ★ v1.4: 상시 고지 문구는 인사 버블의 보조 한 줄로 이전했다(FR-12 AC7) — 여기엔 없다.
//   남는 것은 강등됐을 때의 정직 라벨뿐이다(FR-12 AC4).

import { useState } from 'react'
import type { LlmMode } from '../types_chat'
import { T } from './policy'
import { InfoIcon } from '../components/ui'

export function Composer({
  llmMode,
  pending,
  onSend,
}: {
  llmMode: LlmMode
  pending: boolean
  onSend: (text: string) => void
}) {
  const [text, setText] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if (t === '') return
    setText('')
    onSend(t)
  }

  return (
    <div
      data-testid="composer"
      className="sticky bottom-0 z-30 -mx-4 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95"
    >
      <form onSubmit={submit} className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">메시지 입력</span>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            data-testid="composer-input"
            placeholder="메시지를 입력하세요"
            autoComplete="off"
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-900 transition-colors duration-200 placeholder:text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-white dark:placeholder:text-slate-400 dark:hover:border-slate-600"
          />
        </label>
        <button
          type="submit"
          data-testid="composer-send"
          disabled={pending || text.trim() === ''}
          className="press inline-flex min-h-11 shrink-0 items-center rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          보내기
        </button>
      </form>

      {llmMode === 'chips' && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-slate-600 dark:text-slate-400">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <b data-testid="chips-mode-label" className="text-amber-700 dark:text-amber-300">
            {T.degraded}
          </b>
        </p>
      )}
    </div>
  )
}

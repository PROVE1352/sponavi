// 하단 고정 컴포저: 자유 입력(항상 활성) + 보내기.
// ★ v1.6: 칩은 여기 없다 — 질문의 퀵리플라이 칩·지역 검색은 전부 해당 질문 버블 아래
//   스트림 인라인으로 옮겼다(FR-12 AC1 v1.6, 표준 채팅 문법). 컴포저에는 어떤 칩도 남지 않는다.
// ★ v1.4: 상시 고지 문구는 인사 버블의 보조 한 줄로 이전했다(FR-12 AC7) — 여기엔 없다.
//   남는 것은 강등됐을 때의 정직 라벨뿐이다(FR-12 AC4).

import { useState } from 'react'
import type { RefObject } from 'react'
import type { LlmMode } from '../types_chat'
import { T } from './policy'
import { InfoIcon } from '../components/ui'

export function Composer({
  llmMode,
  pending,
  onSend,
  boxRef,
}: {
  llmMode: LlmMode
  pending: boolean
  onSend: (text: string) => void
  // "맨 아래로" 버튼이 자기 위치를 재는 기준(높이가 상황에 따라 자란다 — 칩 모드 고지 한 줄).
  boxRef?: RefObject<HTMLDivElement | null>
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
      ref={boxRef}
      data-testid="composer"
      className="sticky bottom-0 z-30 -mx-5 border-t border-rule bg-paper px-5 pt-3 pb-4 dark:border-rule-dark dark:bg-paper-dark"
    >
      <form onSubmit={submit} className="flex items-end gap-2.5">
        <label className="min-w-0 flex-1">
          <span className="sr-only">메시지 입력</span>
          {/* 상자 없는 입력 — 밑줄 한 줄만(B·종이 메모). 배경도 투명해 종이 위에 바로 쓴다. */}
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            data-testid="composer-input"
            placeholder="메시지를 입력하세요"
            autoComplete="off"
            className="min-h-11 w-full rounded-none border-0 border-b-[1.5px] border-ink bg-transparent px-0.5 py-3 text-base text-ink placeholder:text-mute dark:border-ink-dark dark:text-ink-dark dark:placeholder:text-mute-dark"
          />
        </label>
        <button
          type="submit"
          data-testid="composer-send"
          disabled={pending || text.trim() === ''}
          className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-paper disabled:opacity-40 dark:bg-ink-dark dark:text-paper-dark"
        >
          {/* 라벨은 낭독으로 남기고(문구 그대로), 화면에는 위 화살표만 — 유일한 원형 예외. */}
          <span className="sr-only">보내기</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="h-[18px] w-[18px]"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>

      {llmMode === 'chips' && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-mute dark:text-mute-dark">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <b
            data-testid="chips-mode-label"
            className="font-normal text-accent-ink dark:text-accent-ink-dark"
          >
            {T.degraded}
          </b>
        </p>
      )}
    </div>
  )
}

// 하단 고정 컴포저: 현재 질문의 칩 + 자유 입력(항상 활성) + 상시 고지(FR-12 AC7).
// 칩·검색은 전부 로컬 처리라 외부로 전송되지 않는다. 자유 입력만 /api/chat/nlu 로 간다.

import { useMemo, useState } from 'react'
import type { Sigungu } from '../types'
import type { Chip, ChipQuestionMsg, LlmMode } from '../types_chat'
import { ChipRow } from './messages'
import { COMPOSER_NOTICE, T, regionChips } from './policy'
import { InfoIcon } from '../components/ui'

const REGION_LIMIT = 12

function RegionSearch({
  sigungu,
  onPick,
}: {
  sigungu: Sigungu[]
  onPick: (chip: Chip) => void
}) {
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const needle = q.trim()
    const list = needle === '' ? sigungu : sigungu.filter((s) => s.nm.includes(needle))
    return regionChips(list, REGION_LIMIT)
  }, [q, sigungu])

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          지역 검색 (입력한 글자는 전송되지 않아요)
        </span>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="region-search"
          placeholder="예: 성북, 인천 서구"
          autoComplete="off"
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
      </label>
      {matches.length > 0 ? (
        <ChipRow chips={matches} select="single" ariaLabel="지역 선택" onPick={onPick} />
      ) : (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          검색 결과가 없어요. 시군구 이름의 일부만 넣어 보세요.
        </p>
      )}
      {sigungu.length > REGION_LIMIT && q.trim() === '' && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          전체 {sigungu.length}개 지역 중 일부만 보여드려요. 검색해서 찾아 주세요.
        </p>
      )}
    </div>
  )
}

export function Composer({
  question,
  sigungu,
  llmMode,
  pending,
  onChip,
  onSend,
}: {
  question: ChipQuestionMsg | null
  sigungu: Sigungu[]
  llmMode: LlmMode
  pending: boolean
  onChip: (chip: Chip, msgId: string) => void
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
      className="sticky bottom-0 z-30 -mx-4 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
    >
      {/* 칩 영역 — 현재 질문 */}
      {question && (
        <div className="mb-3 max-h-[42dvh] overflow-y-auto">
          <p className="mb-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
            {question.text}
          </p>
          {question.searchable ? (
            <RegionSearch sigungu={sigungu} onPick={(c) => onChip(c, question.id)} />
          ) : (
            <ChipRow
              chips={question.chips}
              select={question.select}
              ariaLabel={question.text}
              answeredLabel={question.answeredLabel}
              onPick={(c) => onChip(c, question.id)}
            />
          )}
        </div>
      )}

      <form onSubmit={submit} className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">메시지 입력</span>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            data-testid="composer-input"
            placeholder="자유롭게 입력하셔도 돼요"
            autoComplete="off"
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 placeholder:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-400"
          />
        </label>
        <button
          type="submit"
          data-testid="composer-send"
          disabled={pending || text.trim() === ''}
          className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-brand-600 px-4 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          보내기
        </button>
      </form>

      {/* 상시 고지(FR-12 AC7) — 문구 고정 */}
      <p
        data-testid="composer-notice"
        className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-slate-600 dark:text-slate-400"
      >
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {COMPOSER_NOTICE}
          {llmMode === 'chips' && (
            <>
              {' '}
              <b data-testid="chips-mode-label" className="text-amber-700 dark:text-amber-300">
                {T.degraded}
              </b>
            </>
          )}
        </span>
      </p>
    </div>
  )
}

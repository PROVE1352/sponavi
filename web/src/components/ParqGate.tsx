// PAR-Q 문진 게이트 (FR-07 AC5) — 측정 폼 앞단 스크리닝 고지 턴.
// ★ 문진 응답은 이 컴포넌트의 로컬 상태로만 두고 어디에도 저장·전송하지 않는다
//   (ARCHITECTURE §8 · P-3 비저장). 훅·스토어·서버 어디에도 올라가지 않는다.

import { useState } from 'react'
import { CheckIcon, InfoIcon } from './ui'

export function ParqGate({
  // 이미 통과한 턴(또는 지난 회차)이면 조작을 잠그고 통과 표시만 남긴다.
  done,
  locked = false,
  onContinue,
}: {
  done: boolean
  locked?: boolean
  onContinue: () => void
}) {
  const [checked, setChecked] = useState(false)
  const frozen = done || locked

  return (
    <section
      data-testid="parq-gate"
      aria-label="측정 전 문진 확인"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-100" />
        <p className="text-sm text-slate-700 dark:text-slate-200">
          심장질환·흉통 등 문진 항목에 해당하거나 혈압이 <b>160/100mmHg 이상</b>이면 측정·고강도 운동 전
          전문가와 상담하세요.
        </p>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          data-testid="parq-check"
          checked={frozen ? true : checked}
          disabled={frozen}
          onChange={(e) => setChecked(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        해당 없음, 계속하기
      </label>
      <button
        type="button"
        data-testid="parq-continue"
        onClick={onContinue}
        disabled={frozen || !checked}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border-2 border-brand-600 px-4 py-2 font-semibold text-brand-700 transition hover:bg-brand-50 disabled:opacity-50 dark:text-brand-100 dark:hover:bg-brand-700/20"
      >
        {done && <CheckIcon className="h-4 w-4 shrink-0" />}
        {done ? '확인했어요' : '측정값 입력하기'}
      </button>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
        이 문진 응답은 저장·전송되지 않습니다.
      </p>
    </section>
  )
}

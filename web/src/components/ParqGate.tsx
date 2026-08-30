// PAR-Q 문진 게이트 (FR-07 AC5) — 측정 폼 앞단 스크리닝 고지 턴.
// ★ 문진 응답은 이 컴포넌트의 로컬 상태로만 두고 어디에도 저장·전송하지 않는다
//   (ARCHITECTURE §8 · P-3 비저장). 훅·스토어·서버 어디에도 올라가지 않는다.

import { useState } from 'react'
import { PARQ_PRESET_NOTE } from '../chat/autoplay'
import { BTN_INK, CheckIcon, InfoIcon, ROW_RULE, SECTION_RULE } from './ui'

export function ParqGate({
  // 이미 통과한 턴(또는 지난 회차)이면 조작을 잠그고 통과 표시만 남긴다.
  done,
  locked = false,
  // W2 자동재생이 데모 페르소나 프리셋으로 이 게이트를 대신 통과했는가(★FR-P2).
  // 그 사실을 카드 위에 남긴다 — 실사용자가 "문진을 건너뛰었다"고 오해하면 안 된다(P-1).
  preset = false,
  onContinue,
}: {
  done: boolean
  locked?: boolean
  preset?: boolean
  onContinue: () => void
}) {
  const [checked, setChecked] = useState(false)
  const frozen = done || locked

  return (
    <section
      data-testid="parq-gate"
      aria-label="측정 전 문진 확인"
      className={`flex flex-col ${SECTION_RULE}`}
    >
      <div className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-mute dark:text-mute-dark" />
        <p className="text-[14px] leading-[1.65] text-ink dark:text-ink-dark">
          심장질환·흉통 등 문진 항목에 해당하거나 혈압이 <b>160/100mmHg 이상</b>이면 측정·고강도 운동 전
          전문가와 상담하세요.
        </p>
      </div>
      {preset && (
        <p
          data-testid="parq-preset-note"
          className="mt-2 text-[12.5px] text-mute dark:text-mute-dark"
        >
          {PARQ_PRESET_NOTE}
        </p>
      )}
      <label className="mt-3 flex min-h-11 items-center gap-2 text-[14px] text-ink dark:text-ink-dark">
        <input
          type="checkbox"
          data-testid="parq-check"
          checked={frozen ? true : checked}
          disabled={frozen}
          onChange={(e) => setChecked(e.target.checked)}
          className="h-5 w-5 rounded-none border border-ink accent-ink dark:border-ink-dark dark:accent-ink-dark"
        />
        해당 없음, 계속하기
      </label>
      <button
        type="button"
        data-testid="parq-continue"
        onClick={onContinue}
        disabled={frozen || !checked}
        className={`mt-3 justify-center ${BTN_INK}`}
      >
        {done && <CheckIcon className="h-4 w-4 shrink-0" />}
        {done ? '확인했어요' : '측정값 입력하기'}
      </button>
      <p className={`mt-3 pt-2.5 text-[12px] text-mute dark:text-mute-dark ${ROW_RULE}`}>
        이 문진 응답은 저장·전송되지 않습니다.
      </p>
    </section>
  )
}

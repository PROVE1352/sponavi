import type { AltEdge, ProgramEligibility, Selection } from '../types'
import {
  Badge,
  BTN_INK,
  CheckIcon,
  ChevronDownIcon,
  EligibilityMark,
  ITEM_RULE,
  LINK_ACCENT,
  OkNote,
  SECTION_RULE,
  TINT_BOX,
  WarnIcon,
  XIcon,
} from './ui'

// ★ v1.10(6A): 대체경로 블록은 이 카드 안이 아니라 `assess_result` 메시지의 전폭 히어로다.
// 카드는 판정·사유·신청법·출처만 맡는다.
//
// B · 종이 메모: 카드 상자가 아니라 2px 잉크 괘선으로 시작하는 "판정 섹션"이다.
export function EligibilityCard({ p }: { p: ProgramEligibility }) {
  const eligible = p.eligible
  const failed = p.reasons.filter((r) => !r.ok)
  return (
    <article className={`flex flex-col ${SECTION_RULE} pb-1`} aria-label={`${p.program_name} 예상 자격 결과`}>
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="min-w-0 break-keep font-serif text-[18px] font-extrabold text-ink dark:text-ink-dark">
          {p.program_name}
        </h3>
        <EligibilityMark eligible={eligible} />
      </header>
      <p className="mt-1 text-[13.5px] leading-[1.65] text-mute dark:text-mute-dark">{p.benefit}</p>

      {!p.verified && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-[1.6] text-mute dark:text-mute-dark">
          <WarnIcon className="mt-0.5 w-3.5 h-3.5 shrink-0" />
          공식 확인 필요 (자격 기준 미검증)
        </p>
      )}

      {/* 사유 문장 — 각 항목 ✓/✗ 삼중 표기.
          ✗ 카드는 실패 사유를 첫 줄에 전부 이어 붙이고(FR-02 AC1 v1.10 — 27세 P2 는 연령·소득 둘 다),
          전체 목록은 접어 두되 감추지 않는다(AC4: 줄이는 것은 면적이지 정보가 아니다). */}
      {!eligible && failed.length > 0 ? (
        <div className="mt-2">
          <p
            data-testid="fail-reason-line"
            className="text-[13.5px] leading-[1.65] text-mute dark:text-mute-dark"
          >
            {failed.map((r) => r.message).join(' · ')}
          </p>
          <details className="mt-1.5">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-[12.5px] text-mute underline decoration-1 underline-offset-4 dark:text-mute-dark">
              조건별로 자세히 보기
            </summary>
            <ul className="mt-1">
              {p.reasons.map((r, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-2 py-2 text-[13.5px] leading-[1.6] ${ITEM_RULE}`}
                >
                  {r.ok ? (
                    <CheckIcon className="mt-0.5 w-4 h-4 shrink-0 text-ok dark:text-ok-dark" />
                  ) : (
                    <XIcon className="mt-0.5 w-4 h-4 shrink-0 text-accent-ink dark:text-accent-ink-dark" />
                  )}
                  <span className="text-ink dark:text-ink-dark">{r.message}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : (
        <ul className="mt-2">
          {p.reasons.map((r, i) => (
            <li
              key={i}
              className={`flex items-start gap-2 py-2 text-[13.5px] leading-[1.6] ${ITEM_RULE}`}
            >
              {r.ok ? (
                <CheckIcon className="mt-0.5 w-4 h-4 shrink-0 text-ok dark:text-ok-dark" />
              ) : (
                <XIcon className="mt-0.5 w-4 h-4 shrink-0 text-accent-ink dark:text-accent-ink-dark" />
              )}
              <span className="text-ink dark:text-ink-dark">{r.message}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 예상 선정순위 — 신청(소득무관) vs 선정(우선순위제) 구분 (FR-02 AC5, PRD §6) */}
      {p.selection && <SelectionBlock selection={p.selection} />}

      {/* 신청법·서류·링크 (예상 자격일 때) */}
      {eligible && (
        <div className={`mt-3 pt-3 ${ITEM_RULE}`}>
          <p className="text-[13px] font-bold tracking-[0.04em] text-ink dark:text-ink-dark">
            신청 방법
          </p>
          <p className="mt-1 text-[13.5px] leading-[1.65] text-mute dark:text-mute-dark">
            {p.apply.how}
          </p>
          {p.apply.docs.length > 0 && (
            <div className="mt-2.5">
              <p className="text-[12px] tracking-[0.12em] text-mute dark:text-mute-dark">준비 서류</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {p.apply.docs.map((d, i) => (
                  <li key={i}>
                    <Badge>{d}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <a
            href={p.apply.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-[3px] bg-ink px-4 py-2 text-[14px] font-bold text-paper transition-opacity hover:opacity-90 dark:bg-ink-dark dark:text-paper-dark"
          >
            공식 신청 페이지 열기
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
              <path d="M11 3a1 1 0 1 0 0 2h2.6l-6.3 6.3a1 1 0 1 0 1.4 1.4L15 6.4V9a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-5Z" />
              <path d="M5 5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3a1 1 0 1 0-2 0v3H5V7h3a1 1 0 0 0 0-2H5Z" />
            </svg>
          </a>
        </div>
      )}

      {/* 출처·확인일 각주 */}
      <footer
        className={`mt-3 flex flex-wrap gap-x-2 gap-y-0.5 pt-2.5 text-[12px] leading-[1.6] text-mute dark:text-mute-dark ${ITEM_RULE}`}
      >
        <span className="tracking-[0.12em]">출처</span>
        <span className="min-w-0 break-all">
          <a
            href={p.source.url}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-ink dark:hover:text-ink-dark"
          >
            {p.source.url}
          </a>{' '}
          · 확인일 {p.source.checked}
          {!p.verified && ' · 자격 기준은 공식 신청처에서 최종 확인하세요'}
        </span>
      </footer>
    </article>
  )
}

// 예상 선정순위 블록: "신청은 소득 무관" 강조 + 선정은 우선순위제(대기 가능) 구분.
// 챗 스트림에서도 단독 임베드할 수 있도록 export (ARCHITECTURE §11.4).
export function SelectionBlock({ selection }: { selection: Selection }) {
  return (
    <div data-testid="selection-block" className={`mt-3 ${TINT_BOX}`}>
      <p className="text-[13.5px] font-bold leading-[1.6] text-ink dark:text-ink-dark">
        신청은 소득과 관계없이 할 수 있어요 · 선정은 우선순위제입니다
      </p>
      <p className="mt-1.5">
        <Badge>{selection.rank_label}</Badge>
      </p>
      <p className="mt-1.5 text-[13px] leading-[1.6] text-mute dark:text-mute-dark">
        {selection.note}
      </p>
      {selection.tiebreak && (
        <p className="mt-1 text-[12px] leading-[1.6] text-mute dark:text-mute-dark">
          동점 시: {selection.tiebreak}
        </p>
      )}
      {selection.source?.url && (
        <p className="mt-1.5 text-[12px] text-mute dark:text-mute-dark">
          선정순위 출처{' '}
          <a
            href={selection.source.url}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            공식 안내
          </a>
          {selection.source.checked ? ` · 확인일 ${selection.source.checked}` : ''}
        </p>
      )}
    </div>
  )
}

// 대체경로 블록에 실제로 무엇이 들어가는지 — 블록을 카드 밖(전폭 히어로)에서 그릴 때
// "빈 블록"을 만들지 않으려면 렌더 전에 개수를 알아야 한다(FR-12 AC9 v1.10).
//
// ★ 헤딩의 N 은 '공식 확인' 엣지 수만 센다(FR-02 AC5 v1.10 — 숫자가 곧 약속이다).
//   '검증 대기' 엣지는 버리지 않고 "확인 중 N건"으로 따로 적는다. 그래서 상위 3 자르기는
//   공식 확인 목록에만 걸고, 검증 대기는 잘려 사라지지 않는다.
function isOfficial(a: AltEdge): boolean {
  return a.curated.startsWith('공식 확인')
}

export function altRouteItems(
  card: ProgramEligibility,
  altEdges: AltEdge[],
): { items: AltEdge[]; official: AltEdge[]; pending: AltEdge[]; nowAvailable: boolean } {
  const rank = card.selection?.expected_rank
  const lowOrUndetermined = rank === 4 || rank === 5 || rank == null
  const nowAvailable = card.eligible && card.selection != null && lowOrUndetermined
  const official = altEdges.filter(isOfficial).slice(0, 3)
  const pending = altEdges.filter((a) => !isOfficial(a))
  return { items: [...official, ...pending], official, pending, nowAvailable }
}

// ①②③ — 히어로 항목 번호(명조 인주색 왼쪽 열).
const CIRCLED = ['①', '②', '③', '④', '⑤']

// 히어로(6A): 자격 충족·저순위(4·5/미정) → '지금 바로 되는 것',
// 자격 미충족 → "이용권은 대상이 아니지만, 지금 바로 되는 것 N가지".
// 두 경우 모두 본문 항목은 '공식 확인' 엣지뿐이고, 검증 대기는 아래 한 줄로 정직하게 남는다.
export function AltRoutesBlock({
  card,
  altEdges,
  // 히어로 안 CTA. 기존 "체력 처방 시작" 칩과 같은 액션을 재사용한다(새 진입로를 만들지 않는다).
  onStartFitness,
}: {
  card: ProgramEligibility
  altEdges: AltEdge[]
  onStartFitness?: () => void
}) {
  const { official, pending, nowAvailable } = altRouteItems(card, altEdges)
  if (official.length === 0 && pending.length === 0) return null

  // 공식 확인이 하나도 없으면 "지금 바로 된다"고 말하지 않는다(P-1).
  const onlyPending = official.length === 0
  // 헤딩의 수(N가지 / N건)만 인주색으로 — 화면당 한두 군데 원칙.
  const heading = onlyPending ? (
    <>
      확인 중인 대안{' '}
      <span className="text-accent-ink dark:text-accent-ink-dark">{pending.length}건</span>
    </>
  ) : card.eligible ? (
    <>지금 바로 되는 것</>
  ) : (
    <>
      이용권은 대상이 아니지만, 지금 바로 되는 것{' '}
      <span className="text-accent-ink dark:text-accent-ink-dark">{official.length}가지</span>
    </>
  )
  const desc = onlyPending
    ? '공식 페이지 확인 전이라 아직 "지금 된다"고 말씀드리지 않습니다.'
    : card.eligible
      ? '선정을 기다리는 동안, 소득·자격과 무관하게 지금 바로 이용할 수 있는 공식 확인 대안입니다.'
      : '이용권 자격과 무관하게 지금 이용할 수 있는 공식 확인 대안입니다.'

  return (
    <div
      data-testid={nowAvailable ? 'now-available-block' : 'alt-routes-block'}
      className={`flex flex-col ${SECTION_RULE}`}
    >
      <p className="font-serif text-[24px] font-extrabold leading-[1.35] tracking-[-0.01em] text-ink dark:text-ink-dark">
        {heading}
      </p>
      <p className="mt-2 text-[13.5px] leading-[1.6] text-mute dark:text-mute-dark">{desc}</p>

      {official.length > 0 && (
        <ul className="mt-3.5">
          {official.map((a, i) => (
            <li
              key={`${a.to}-${i}`}
              data-testid={nowAvailable ? 'now-available-item' : 'alt-route-item'}
              className={`grid grid-cols-[28px_minmax(0,1fr)] gap-x-2 py-3.5 ${ITEM_RULE}`}
            >
              <span
                aria-hidden="true"
                className="font-serif text-[20px] font-extrabold leading-[1.2] text-accent-ink dark:text-accent-ink-dark"
              >
                {CIRCLED[i] ?? '·'}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 break-keep font-serif text-[17px] font-extrabold text-ink dark:text-ink-dark">
                    {a.program?.name ?? a.note}
                  </span>
                  <OkNote className="shrink-0">공식 확인</OkNote>
                </div>
                <p className="text-[13.5px] leading-[1.65] text-mute dark:text-mute-dark">
                  {a.program?.benefit ?? a.note}
                </p>
                {a.program?.apply_url && (
                  <a
                    href={a.program.apply_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={`inline-flex min-h-11 items-center text-[13px] ${LINK_ACCENT}`}
                  >
                    출처·신청 링크 열기
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 검증 대기 엣지: 헤딩의 N 에는 넣지 않되 존재는 숨기지 않는다(P-1) */}
      {pending.length > 0 && !onlyPending && (
        <p
          data-testid="alt-route-pending"
          className={`pt-3 text-[12.5px] leading-[1.6] text-mute dark:text-mute-dark ${ITEM_RULE}`}
        >
          ※ 확인 중 {pending.length}건 — {pending.map((a) => a.program?.name ?? a.note).join(' · ')}
        </p>
      )}
      {onlyPending && (
        <ul data-testid="alt-route-pending" className="mt-3">
          {pending.map((a, i) => (
            <li
              key={`${a.to}-${i}`}
              className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 py-3 ${ITEM_RULE}`}
            >
              <span className="font-serif text-[17px] font-extrabold text-ink dark:text-ink-dark">
                {a.program?.name ?? a.note}
              </span>
              <Badge icon={<WarnIcon className="w-3 h-3" />}>큐레이션 · {a.curated}</Badge>
            </li>
          ))}
        </ul>
      )}

      {onStartFitness && (
        <button
          type="button"
          data-testid="hero-fitness-cta"
          onClick={onStartFitness}
          className={`mt-4 justify-between ${BTN_INK}`}
        >
          내 체력에 맞는 운동까지 보기
          <ChevronDownIcon className="w-[18px] h-[18px] shrink-0" />
        </button>
      )}
    </div>
  )
}

// 채팅 메시지 렌더러. 봇 발화는 안내자 "나비"(PRD §2.5) 이름·아바타와 함께 나온다.
// 버블 구분은 색 + 정렬 + 아이콘 삼중(색맹 안전, A11Y-3).
// 사실을 말하는 것은 나비 버블이 아니라 카드다 — 카드는 기존 컴포넌트를 그대로 재사용한다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AssessRequest, AssessResponse } from '../types'
import type {
  Chip,
  ChatMessage,
  BotTextMsg,
  ChipQuestionMsg,
  AssessResultMsg,
  FitnessTurnApi,
} from '../types_chat'
import { AltRoutesBlock, EligibilityCard, altRouteItems } from '../components/EligibilityCard'
import { PathDiagram } from '../components/PathDiagram'
import { SupplyGapBanner } from '../components/SupplyGapBanner'
import { AltRow, VoucherRow, useFacilityAccessibility } from '../components/NearbyList'
import { ParqGate } from '../components/ParqGate'
import { FitnessFormCard } from '../components/FitnessForm'
import { FitnessResultCard } from '../components/FitnessResult'
import { ErrorPanel } from '../components/ErrorPanel'
import { Badge, CheckIcon, InfoIcon } from '../components/ui'
import { CardCarousel, CardDeck } from '../components/Carousel'
import { BOT_NAME, T, primaryProgramId } from './policy'
import { Typewriter } from './Typewriter'

// 데스크톱(lg = 64rem) 여부. 결과는 이 한 가지로 두 형태 중 하나만 마운트한다 —
// CSS 로 둘 다 그려 놓고 숨기면 같은 카드가 DOM 에 두 벌 생겨 낭독·검사가 겹친다.
const LG_QUERY = '(min-width: 64rem)'

function useIsWide(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(LG_QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(LG_QUERY)
    const onChange = () => setWide(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

// 나비 아바타 — 인라인 SVG 단색 투톤(이모지·그라데이션 금지).
// 액션 블루 디스크 위에 흰 나비: 윗날개는 불투명, 아랫날개는 반투명(투톤).
export function NabiAvatar({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full bg-brand-600 text-white ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
        {/* 윗날개 한 쌍 */}
        <path
          d="M11.2 8.5C9.7 6 7 4.8 5.15 5.9 3.35 7 3.45 9.7 5.05 11.25c1.05 1.05 3.1 1.7 6.15 1.95V8.5Z"
          fill="currentColor"
        />
        <path
          d="M12.8 8.5c1.5-2.5 4.2-3.7 6.05-2.6 1.8 1.1 1.7 3.8.1 5.35-1.05 1.05-3.1 1.7-6.15 1.95V8.5Z"
          fill="currentColor"
        />
        {/* 아랫날개 한 쌍(반투명 = 투톤) */}
        <path
          d="M11.2 14.05c-2.6.2-4.25.95-4.95 2.15-.8 1.4.1 3.05 1.75 3.25 1.7.2 2.9-1.35 3.2-3.35v-2.05Z"
          fill="currentColor"
          fillOpacity="0.62"
        />
        <path
          d="M12.8 14.05c2.6.2 4.25.95 4.95 2.15.8 1.4-.1 3.05-1.75 3.25-1.7.2-2.9-1.35-3.2-3.35v-2.05Z"
          fill="currentColor"
          fillOpacity="0.62"
        />
        {/* 몸통 + 더듬이 */}
        <path
          d="M12 7.8v9.1M12 7.8c-.1-1-.8-1.7-1.8-1.85M12 7.8c.1-1 .8-1.7 1.8-1.85"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}

function UserIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0 1.5c-3 0-5.5 1.7-5.5 3.8 0 .9.7 1.2 1.5 1.2h8c.8 0 1.5-.3 1.5-1.2 0-2.1-2.5-3.8-5.5-3.8Z" />
    </svg>
  )
}

// 봇 레인: 아바타 + 발신자명 + 내용. 내용은 버블이거나(짧은 말) 카드다(사실).
// 연속된 나비 발화는 아바타·이름을 한 번만 보여 준다(첫 버블에만).
export function BotLane({
  children,
  label,
  showSender = true,
}: {
  children: ReactNode
  label?: string
  showSender?: boolean
}) {
  return (
    <div className="flex w-full min-w-0 items-start gap-2">
      {showSender ? <NabiAvatar /> : <span aria-hidden="true" className="w-7 shrink-0" />}
      <div className="min-w-0 flex-1">
        {showSender && (
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-400">
            {label ?? BOT_NAME}
          </p>
        )}
        {children}
      </div>
    </div>
  )
}

function BotBubble({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'notice' }) {
  const styles =
    tone === 'notice'
      ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100'
      : 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
  return (
    <div
      className={`max-w-[46rem] rounded-2xl rounded-tl-md border px-4 py-3 text-base leading-[1.6] shadow-card ${styles}`}
    >
      {children}
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex w-full min-w-0 items-start justify-end gap-2">
      <div className="max-w-[36rem] min-w-0 rounded-2xl rounded-tr-md bg-brand-700 px-4 py-2.5 text-base leading-[1.6] text-white shadow-card">
        <span className="sr-only">내가 보낸 말: </span>
        <span className="break-words">{text}</span>
      </div>
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-700 text-white dark:bg-slate-600"
      >
        <UserIcon className="h-4 w-4" />
      </span>
    </div>
  )
}

// 칩 그룹. 단일 선택은 radiogroup 시맨틱, 즉시 실행 버튼은 group.
export function ChipRow({
  chips,
  select,
  ariaLabel,
  answeredLabel,
  onPick,
}: {
  chips: Chip[]
  select: 'single' | 'action'
  ariaLabel: string
  answeredLabel?: string
  onPick: (chip: Chip) => void
}) {
  if (chips.length === 0) return null
  const single = select === 'single'
  return (
    <div
      role={single ? 'radiogroup' : 'group'}
      aria-label={ariaLabel}
      className="flex flex-wrap gap-2"
    >
      {chips.map((c) => {
        const chosen = answeredLabel != null && answeredLabel === c.label
        return (
          <button
            key={c.id}
            type="button"
            data-testid={`chip-${c.id}`}
            role={single ? 'radio' : undefined}
            aria-checked={single ? chosen : undefined}
            onClick={() => onPick(c)}
            className={
              'press inline-flex min-h-11 max-w-full flex-col justify-center rounded-full border-[1.5px] px-4 py-2 text-left text-sm font-semibold transition-colors duration-200 ease-out disabled:opacity-60 ' +
              (chosen
                ? 'border-brand-600 bg-brand-600 text-white shadow-card'
                : 'border-brand-200 bg-white text-brand-800 hover:border-brand-300 hover:bg-brand-50 dark:border-brand-500/40 dark:bg-slate-900 dark:text-brand-100 dark:hover:border-brand-300/60 dark:hover:bg-brand-700/25')
            }
          >
            <span className="inline-flex items-center gap-1.5">
              {chosen && <CheckIcon className="h-4 w-4 shrink-0" />}
              <span className="break-keep">{c.label}</span>
            </span>
            {c.hint && (
              <span
                className={
                  'mt-0.5 text-xs font-normal break-keep ' +
                  (chosen ? 'text-brand-50' : 'text-slate-600 dark:text-slate-400')
                }
              >
                {c.hint}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── 질문 버블 + 인라인 칩(FR-12 AC1 v1.6) ────────────────────────────────
// 칩은 컴포저가 아니라 **질문 버블 바로 아래**에 붙는다(표준 퀵리플라이 문법).
//   · 버블 타이핑이 끝난 뒤에야 칩이 나타난다(AC10 v1.6) — 질문보다 답이 먼저 뜨지 않는다.
//   · 단일 선택 질문은 "지금 열려 있는 질문"일 때만 살아 있다. 지나간 질문은 칩을 걷고
//     선택 표시만 남긴다 — 과거 칩을 눌러 상태가 꼬이는 경로 자체를 없앤다.
//   · 즉시 실행 묶음(select='action': 후속 액션·FAQ·퀵스타트)은 계속 눌러 쓰는 버튼이라 잠기지 않는다.
function ChipQuestion({
  msg,
  h,
  showSender,
  typing,
}: {
  msg: ChipQuestionMsg
  h: MessageHandlers
  showSender: boolean
  typing: boolean
}) {
  const [done, setDone] = useState(!typing)
  const onDone = useCallback(() => setDone(true), [])
  useEffect(() => {
    if (!typing) setDone(true)
  }, [typing])

  const locked = msg.select === 'single' && msg.id !== h.activeQuestionId

  return (
    <BotLane showSender={showSender}>
      <div data-testid={`question-${msg.question}`}>
        <BotBubble>
          <p className="break-words whitespace-pre-line">
            <Typewriter text={msg.text} animate={typing} onDone={onDone} />
          </p>
        </BotBubble>

        {locked
          ? msg.answeredLabel && (
              <p
                data-testid="chip-answered"
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400"
              >
                <CheckIcon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                {msg.answeredLabel} 선택함
              </p>
            )
          : done && (
              // msg-in = 버블 타이핑 완료 뒤의 fade+상승 등장(reduced-motion 에서는 비활성).
              <div data-testid="inline-chips" className="msg-in mt-2">
                <ChipRow
                  chips={msg.chips}
                  select={msg.select}
                  ariaLabel={msg.text}
                  answeredLabel={msg.answeredLabel}
                  onPick={(c) => h.onChip(c, msg.id)}
                />
              </div>
            )}
      </div>
    </BotLane>
  )
}

// ── 판정 결과(FR-12 AC9 v1.7) ────────────────────────────────────────────
// 스트림 하나로 정보가 완결된다(AC3) — 패널을 열지 않아도 여기서 다 볼 수 있다.
//   모바일(<lg): 판정 카드 → 대체경로 → 공급공백·커버리지 → 시설 을 단일 가로 덱의 슬라이드로
//   데스크톱(lg+): 예전처럼 세로 블록(그리드 + 배너 + 시설 요약 카드)
// 시설 미리보기 개수는 두 형태가 같다.
const VOUCHER_PREVIEW = 3
const ALT_PREVIEW = 2

const ELIGIBILITY_NOTE = (
  <>
    ※ 여기 표시된 것은 <b>예상 자격</b>입니다. 최종 자격은 각 공식 신청처에서 확인됩니다.
  </>
)

// 시설 요약의 머리(구 단위 카운트 배지)와 발(나머지 안내 + 패널 열기 버튼)은
// 덱 슬라이드와 데스크톱 카드가 같은 것을 쓴다.
function FacilityCounts({ req, data }: { req: AssessRequest; data: AssessResponse }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {/* 이용권은 구 단위 카운트(반경 문구 금지, FR-04 AC2) */}
      <Badge tone="brand">
        {req.sigungu_nm} 이용권 가맹 {data.nearby.voucher_facilities.length}곳
      </Badge>
      <Badge tone="ok">공공·대안 {data.nearby.alternatives.length}곳</Badge>
    </div>
  )
}

function FacilityRest({ data }: { data: AssessResponse }) {
  const restV = Math.max(0, data.nearby.voucher_facilities.length - VOUCHER_PREVIEW)
  const restA = Math.max(0, data.nearby.alternatives.length - ALT_PREVIEW)
  if (restV === 0 && restA === 0) return null
  return (
    <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
      나머지 {restV > 0 ? `이용권 가맹 ${restV}곳` : ''}
      {restV > 0 && restA > 0 ? ' · ' : ''}
      {restA > 0 ? `공공·대안 ${restA}곳` : ''}은 시설 목록에서 볼 수 있어요.
    </p>
  )
}

function FacilityActions({ onOpenPanel }: { onOpenPanel: (tab: 'map' | 'list') => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        data-testid="open-map-panel"
        onClick={() => onOpenPanel('map')}
        className="press inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
      >
        지도에서 보기
      </button>
      <button
        type="button"
        data-testid="open-list-panel"
        onClick={() => onOpenPanel('list')}
        className="press inline-flex min-h-11 items-center gap-1.5 rounded-lg border-[1.5px] border-brand-500 px-4 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50 dark:border-brand-500/60 dark:text-brand-100 dark:hover:bg-brand-700/25"
      >
        시설 목록 전체 보기
      </button>
    </div>
  )
}

function EmptyFacilities() {
  return (
    <p className="mt-3 rounded-xl bg-slate-100 p-4 text-sm text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
      이 조건으로 보여드릴 근처 시설이 없습니다. 빈자리를 임의로 채우지 않고 있는 그대로 알려드려요.
    </p>
  )
}

// dvoucher 가맹 시설의 접근성 보조 정보(FR-10). 두 형태가 같은 훅을 쓴다.
function usePreviewAccessibility(data: AssessResponse) {
  const vouchers = useMemo(
    () => data.nearby.voucher_facilities.slice(0, VOUCHER_PREVIEW),
    [data.nearby.voucher_facilities],
  )
  const alternatives = useMemo(
    () => data.nearby.alternatives.slice(0, ALT_PREVIEW),
    [data.nearby.alternatives],
  )
  const dvoucherIds = useMemo(
    () => vouchers.filter((v) => v.source === 'dvoucher').map((v) => v.id),
    [vouchers],
  )
  const { access, error } = useFacilityAccessibility(dvoucherIds)
  return { vouchers, alternatives, access, error }
}

// ── 모바일 결과 덱 ───────────────────────────────────────────────────────
function ResultDeck({
  req,
  data,
  onOpenPanel,
}: {
  req: AssessRequest
  data: AssessResponse
  onOpenPanel: (tab: 'map' | 'list') => void
}) {
  const { vouchers, alternatives, access, error } = usePreviewAccessibility(data)
  const primaryId = primaryProgramId(req)
  const primary = data.eligibility.find((p) => p.program_id === primaryId)
  // 덱은 한 번에 한 장만 보이므로 "내 상황의 제도"가 첫 장이어야 한다
  // (비장애=스포츠강좌이용권 / 장애=장애인스포츠강좌이용권). 데스크톱은 전부 한눈에 보여 순서 유지.
  const cards = useMemo(
    () => [...data.eligibility].sort((a, b) => Number(b.program_id === primaryId) - Number(a.program_id === primaryId)),
    [data.eligibility, primaryId],
  )
  const altEdges = data.alt_edges ?? []
  const altItems = primary ? altRouteItems(primary, altEdges).items : []
  const showAlt = primary != null && altItems.length > 0

  const slides =
    data.eligibility.length + (showAlt ? 1 : 0) + 1 + 1 + vouchers.length + alternatives.length

  return (
    <section data-testid="assess-cards" aria-label="예상 자격 결과" className="space-y-2">
      <CardDeck
        testId="result-deck"
        ariaLabel={`판정 결과 카드 ${slides}장, 좌우로 이동`}
        hint={T.deckSwipe}
        count={slides}
      >
        {/* ① 제도별 판정 카드. 대체경로는 다음 슬라이드가 맡으므로 카드 안에는 넣지 않는다. */}
        {cards.map((p) => (
          <li key={p.program_id} className="min-w-0">
            <EligibilityCard p={p} />
          </li>
        ))}

        {/* ② '지금 바로 되는 것' / 대체경로 */}
        {showAlt && primary && (
          <li key="alt-routes" className="min-w-0">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
              <AltRoutesBlock card={primary} altEdges={altEdges} />
            </div>
          </li>
        )}

        {/* ③ 공급공백 · 커버리지 */}
        <li key="supply-gap" className="min-w-0">
          <SupplyGapBanner gap={data.supply_gap} />
        </li>

        {/* ④ 근처 자원 머리 슬라이드(카운트 + 패널 열기) */}
        <li key="facility-head" className="min-w-0">
          <section
            data-testid="facility-summary"
            aria-label="근처 자원 요약"
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
              근처 자원
            </h3>
            <div className="mt-2">
              <FacilityCounts req={req} data={data} />
            </div>
            {vouchers.length + alternatives.length === 0 && <EmptyFacilities />}
            <FacilityRest data={data} />
            <FacilityActions onOpenPanel={onOpenPanel} />
          </section>
        </li>

        {/* ⑤ 시설 카드들(이용권 가맹 → 공공·대안). VoucherRow/AltRow 가 이미 <li> 다. */}
        {vouchers.map((v) => (
          <VoucherRow key={v.id} v={v} accessibility={access[v.id]} accessError={error} />
        ))}
        {alternatives.map((a) => (
          <AltRow key={a.id} a={a} />
        ))}
      </CardDeck>

      <p className="text-xs text-slate-600 dark:text-slate-400">{ELIGIBILITY_NOTE}</p>
    </section>
  )
}

// ── 데스크톱(lg+) 세로 블록 — v1.6 까지의 형태 그대로 ────────────────────
function ResultBlocks({
  req,
  data,
  onOpenPanel,
}: {
  req: AssessRequest
  data: AssessResponse
  onOpenPanel: (tab: 'map' | 'list') => void
}) {
  const { vouchers, alternatives, access, error } = usePreviewAccessibility(data)
  const primaryId = primaryProgramId(req)
  const cards = vouchers.length + alternatives.length

  return (
    <div className="space-y-4">
      <section data-testid="assess-cards" aria-label="제도별 예상 자격" className="space-y-3">
        <CardCarousel
          testId="assess-carousel"
          ariaLabel={`예상 자격 카드 ${data.eligibility.length}장, 좌우로 이동`}
          count={data.eligibility.length}
          layout="grid"
          fade="page"
        >
          {data.eligibility.map((p) => (
            <li key={p.program_id} className="min-w-0">
              <EligibilityCard
                p={p}
                altEdges={p.program_id === primaryId ? data.alt_edges : undefined}
              />
            </li>
          ))}
        </CardCarousel>
        <p className="text-xs text-slate-600 dark:text-slate-400">{ELIGIBILITY_NOTE}</p>
      </section>

      <SupplyGapBanner gap={data.supply_gap} />

      <section
        data-testid="facility-summary"
        aria-label="근처 자원 요약"
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
            근처 자원
          </h3>
          <FacilityCounts req={req} data={data} />
        </div>

        {cards > 0 ? (
          <div className="mt-3">
            <CardCarousel
              testId="facility-carousel"
              ariaLabel={`근처 자원 카드 ${cards}장, 좌우로 이동`}
              count={cards}
              layout="stack"
              fade="card"
            >
              {vouchers.map((v) => (
                <VoucherRow key={v.id} v={v} accessibility={access[v.id]} accessError={error} />
              ))}
              {alternatives.map((a) => (
                <AltRow key={a.id} a={a} />
              ))}
            </CardCarousel>
          </div>
        ) : (
          <EmptyFacilities />
        )}

        <FacilityRest data={data} />
        <FacilityActions onOpenPanel={onOpenPanel} />
      </section>
    </div>
  )
}

function AssessResult({
  msg,
  onOpenPanel,
}: {
  msg: AssessResultMsg
  onOpenPanel: (tab: 'map' | 'list') => void
}) {
  const wide = useIsWide()
  return wide ? (
    <ResultBlocks req={msg.req} data={msg.data} onOpenPanel={onOpenPanel} />
  ) : (
    <ResultDeck req={msg.req} data={msg.data} onOpenPanel={onOpenPanel} />
  )
}

// 나비 발화 버블(FR-12 AC10 타이프라이터 적용 대상은 여기 본문 텍스트뿐이다 —
// 카드·고지 블록·사용자 버블에는 적용하지 않는다).
function BotTextBubble({
  msg,
  showSender,
  typing,
}: {
  msg: BotTextMsg
  showSender: boolean
  typing: boolean
}) {
  // 본문이 다 나온 뒤에야 보조 줄을 보여 준다(그 전엔 자리만 잡고 투명).
  const [done, setDone] = useState(!typing)
  const onDone = useCallback(() => setDone(true), [])
  useEffect(() => {
    if (!typing) setDone(true)
  }, [typing])

  return (
    <BotLane showSender={showSender}>
      <BotBubble tone={msg.tone}>
        <p className="break-words whitespace-pre-line">
          <Typewriter text={msg.text} animate={typing} onDone={onDone} />
        </p>
        {/* 보조 줄은 DOM 에 처음부터 있어 낭독은 1회 — 시각적으로만 뒤늦게 나타난다.
            투명도만 바뀌므로 버블 높이가 도중에 변하지 않는다(스트림 흔들림 0). */}
        {msg.sub && (
          <p
            data-testid="bot-sub"
            className={
              'mt-2 text-[13px] leading-snug break-words whitespace-pre-line text-slate-600 transition-opacity duration-200 ease-out dark:text-slate-400 ' +
              (done ? 'opacity-100' : 'opacity-0')
            }
          >
            {msg.sub}
          </p>
        )}
        {msg.bullets && msg.bullets.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {msg.bullets.map((b, i) => (
              <li key={i} className="break-words">
                {b}
              </li>
            ))}
          </ul>
        )}
        {msg.links && msg.links.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {msg.links.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="press inline-flex min-h-11 items-center rounded-lg border-[1.5px] border-brand-500 px-4 text-sm font-semibold text-brand-800 hover:bg-brand-50 dark:border-brand-500/60 dark:text-brand-100 dark:hover:bg-brand-700/25"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </BotBubble>
    </BotLane>
  )
}

export interface MessageHandlers {
  onChip: (chip: Chip, msgId: string) => void
  onRetry: () => void
  onOpenPanel: (tab: 'map' | 'list') => void
  onApplyFilter: (sports: string[]) => void
  // 지금 열려 있는 질문. 이 id 가 아닌 단일 선택 질문의 칩은 잠긴다(FR-12 AC1 v1.6).
  activeQuestionId: string | null
  // 체력 레인 3턴의 상태·액션(useFitness + 스토어 진행도).
  fitness: FitnessTurnApi
}

export function MessageView({
  msg,
  h,
  showSender = true,
  typing = false,
}: {
  msg: ChatMessage
  h: MessageHandlers
  // 연속된 나비 발화 묶음의 첫 메시지에서만 아바타·이름을 보여 준다.
  showSender?: boolean
  // 타이프라이터를 재생할 최신 봇 발화인가(FR-12 AC10). 나머지는 완성 상태로 그린다.
  typing?: boolean
}) {
  switch (msg.kind) {
    case 'user_text':
      return <UserBubble text={msg.text} />

    case 'bot_text':
      return <BotTextBubble msg={msg} showSender={showSender} typing={typing} />

    case 'chip_question':
      return <ChipQuestion msg={msg} h={h} showSender={showSender} typing={typing} />


    case 'path':
      return (
        <BotLane showSender={showSender}>
          <PathDiagram path={msg.path} />
        </BotLane>
      )

    case 'assess_result':
      return (
        <BotLane showSender={showSender}>
          <AssessResult msg={msg} onOpenPanel={h.onOpenPanel} />
        </BotLane>
      )

    // ── 체력 레인 3턴 ────────────────────────────────────────────────
    case 'fitness_parq':
      return (
        <BotLane showSender={showSender}>
          <ParqGate
            done={h.fitness.parqOk && msg.laneId === h.fitness.laneId}
            locked={msg.laneId !== h.fitness.laneId}
            onContinue={h.fitness.onParqContinue}
          />
        </BotLane>
      )

    case 'fitness_form':
      return (
        <BotLane showSender={showSender}>
          <FitnessFormCard
            lane={h.fitness}
            locked={msg.laneId !== h.fitness.laneId}
            onSubmit={h.fitness.onSubmit}
          />
        </BotLane>
      )

    case 'fitness_result':
      return (
        <BotLane showSender={showSender}>
          <FitnessResultCard
            result={msg.result}
            nearby={msg.nearby}
            onApplyFilter={h.onApplyFilter}
            ai={h.fitness.ai}
            aiLoading={h.fitness.aiLoading}
            aiError={h.fitness.aiError}
            onRequestAi={h.fitness.requestAi}
            onCancelAi={h.fitness.cancelAi}
            // AI 조작부는 현재 회차의 최신 결과 카드에만(지난 결과는 기록으로 고정).
            showAi={msg.laneId === h.fitness.laneId && msg.id === h.fitness.resultMsgId}
          />
        </BotLane>
      )

    case 'faq_answer':
      return (
        <BotLane showSender={showSender}>
          <section
            data-testid="faq-answer"
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="flex items-start gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-100" />
              {msg.entry.q}
            </p>
            {/* 답변 원문의 줄바꿈을 그대로 살린다(선정순위 5줄 리스트 등 — 서버 사전이 \n 을 담는다) */}
            <p
              data-testid="faq-answer-body"
              className="mt-2 text-base leading-[1.6] whitespace-pre-line text-slate-700 dark:text-slate-200"
            >
              {msg.entry.answer}
            </p>
            <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
              출처{' '}
              <a
                href={msg.entry.source_url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline decoration-dotted underline-offset-2"
              >
                {msg.entry.source_url}
              </a>{' '}
              · 확인일 {msg.entry.checked}
            </p>
          </section>
        </BotLane>
      )

    case 'error':
      return (
        <BotLane showSender={showSender}>
          <ErrorPanel error={msg.error} onRetry={h.onRetry} />
        </BotLane>
      )
  }
}

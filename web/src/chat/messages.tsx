// 채팅 메시지 렌더러. 봇 발화는 화자 라벨("스포내비", PRD §2.5)·아바타와 함께 나온다.
// 버블 구분은 색 + 정렬 + 아이콘 삼중(색맹 안전, A11Y-3).
// 사실을 말하는 것은 화자 버블이 아니라 카드다 — 카드는 기존 컴포넌트를 그대로 재사용한다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AssessRequest, AssessResponse } from '../types'
import type { AccessibilityMap } from '../types_accessibility'
import type {
  Chip,
  ChatMessage,
  BotTextMsg,
  ChipQuestionMsg,
  AssessResultMsg,
  FaqAnswerMsg,
  FitnessTurnApi,
} from '../types_chat'
import { AltRoutesBlock, EligibilityCard, PublicFeeDetail, altRouteItems } from '../components/EligibilityCard'
import { PathDiagram } from '../components/PathDiagram'
import { SupplyGapBanner } from '../components/SupplyGapBanner'
import { AltRow, VoucherRow, useFacilityAccessibility } from '../components/NearbyList'
import { ParqGate } from '../components/ParqGate'
import { FitnessFormCard } from '../components/FitnessForm'
import { FitnessResultCard } from '../components/FitnessResult'
import { ErrorPanel } from '../components/ErrorPanel'
import { Badge, CheckIcon, InfoIcon, KeepDates } from '../components/ui'
import { CardCarousel, CardDeck } from '../components/Carousel'
import { altPoolLabel } from '../lib/sports'
import { BOT_NAME, T, primaryProgramId, specialAnswerChip, toggleSpecialSelection } from './policy'
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

// 봇 레인: 아바타 없음(B·종이 메모 — 말풍선도 아바타도 두지 않는다).
// 봇 턴의 첫 문장 위에만 11px 자간 0.14em 뮤트 "스포내비" 라벨이 붙는다.
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
    <div className="flex w-full min-w-0 flex-col gap-[5px]">
      {showSender && (
        <span className="text-[11px] tracking-[0.14em] text-mute dark:text-mute-dark">
          {label ?? BOT_NAME}
        </span>
      )}
      {children}
    </div>
  )
}

// 봇 발화 = 말풍선 없는 왼쪽 본문 16px/1.7. 폰에서는 한 줄이 330px 를 넘지 않는다.
// notice 톤만 예외로 tint 바탕 + 1px 괘선 상자(radius 3) — 상자가 아니라 강조 메모다.
function BotBubble({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'notice' }) {
  const styles =
    tone === 'notice'
      ? 'rounded-[3px] border border-rule bg-tint px-3 py-2.5 text-ink dark:border-rule-dark dark:bg-tint-dark dark:text-ink-dark'
      : 'text-ink dark:text-ink-dark'
  return (
    <div className={`max-w-[330px] text-[16px] leading-[1.7] lg:max-w-[46rem] ${styles}`}>
      {children}
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex w-full min-w-0 justify-end">
      <div className="max-w-[85%] min-w-0 rounded-[3px] bg-tint px-3 py-[7px] text-[15px] leading-[1.5] text-ink dark:bg-tint-dark dark:text-ink-dark">
        <span className="sr-only">내가 보낸 말: </span>
        <span className="break-words">{text}</span>
      </div>
    </div>
  )
}

// ── 칩 두 종류(B·종이 메모) ──────────────────────────────────────────────
// 생김새는 aria 의 select 가 아니라 **칩이 하는 일**(action.kind)이 정한다 —
// 퀵스타트·재시작 확인은 radiogroup 이 아닌 'action' 묶음이지만 "고르는 답"이기 때문이다.
//   answer = 답을 고르는 칩(연령·성별·지역·소득·장애 · 퀵스타트 · 예/아니요)
//            → 1.5px 잉크 네모(radius 3), 고른 것은 잉크 채움 + 종이 글자
//   action = 행동 칩(지도·목록·체력·처음부터·FAQ · 답 고치기)
//            → 테두리 없는 밑줄 텍스트 버튼(인주색), 44px 높이는 그대로
type ChipStyle = 'answer' | 'action'

function chipStyleOf(c: Chip): ChipStyle {
  switch (c.action.kind) {
    case 'answer':
    case 'persona':
    case 'manual_start':
      return 'answer'
    // "처음부터 다시"는 행동, 그 뒤 예/아니요는 고르는 답이다.
    case 'restart':
      return c.action.step === 'ask' ? 'action' : 'answer'
    default:
      return 'action'
  }
}

// 행동 칩 묶음에서 딱 하나만 잉크 700 으로 세운다(Main.dc.html: "체력 처방 시작").
function isEmphasizedAction(c: Chip): boolean {
  return c.action.kind === 'start_fitness'
}

// 답 칩의 네모 모양(고름 = 잉크 채움). 단일·다중 선택이 같은 문법을 쓴다.
function answerChipCls(chosen: boolean): string {
  return (
    'press inline-flex min-h-11 max-w-full flex-col justify-center rounded-[3px] border-[1.5px] px-3.5 py-2 text-left text-sm disabled:opacity-60 ' +
    (chosen
      ? 'border-ink bg-ink text-paper dark:border-ink-dark dark:bg-ink-dark dark:text-paper-dark'
      : 'border-ink bg-transparent text-ink hover:bg-tint dark:border-ink-dark dark:text-ink-dark dark:hover:bg-tint-dark')
  )
}

// 다중 선택(체크박스 묶음) + "선택 완료". 고른 것들은 이 컴포넌트의 로컬 상태이고,
// 완료를 눌렀을 때만 합친 답 칩 하나로 컨트롤러에 넘긴다(LLM 0회 · 칩 경로 그대로).
// "해당 없음"은 배타 선택(policy.toggleSpecialSelection).
function MultiChipRow({
  chips,
  ariaLabel,
  onPick,
}: {
  chips: Chip[]
  ariaLabel: string
  onPick: (chip: Chip) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  if (chips.length === 0) return null
  return (
    <div className="space-y-2.5">
      <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-2">
        {chips.map((c) => {
          const chosen = selected.includes(c.id)
          return (
            <button
              key={c.id}
              type="button"
              role="checkbox"
              aria-checked={chosen}
              data-testid={`chip-${c.id}`}
              onClick={() => setSelected((cur) => toggleSpecialSelection(cur, c.id))}
              className={answerChipCls(chosen)}
            >
              <span className="inline-flex items-center gap-1.5">
                {chosen && <CheckIcon className="h-4 w-4 shrink-0" />}
                <span className="break-keep">{c.label}</span>
              </span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        data-testid="chip-special-confirm"
        disabled={selected.length === 0}
        onClick={() => onPick(specialAnswerChip(selected))}
        className="press inline-flex min-h-11 items-center rounded-[3px] bg-ink px-4 py-2 text-[14px] font-bold text-paper transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-ink-dark dark:text-paper-dark"
      >
        {T.specialConfirm}
      </button>
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
  // 밑줄 텍스트만 있는 줄은 네모 칩보다 넉넉한 가로 간격을 쓴다(Main.dc.html: 6px 18px).
  const allAction = chips.every((c) => chipStyleOf(c) === 'action')
  return (
    <div
      role={single ? 'radiogroup' : 'group'}
      aria-label={ariaLabel}
      className={'flex flex-wrap ' + (allAction ? 'gap-x-[18px] gap-y-1.5' : 'gap-2')}
    >
      {chips.map((c) => {
        const chosen = answeredLabel != null && answeredLabel === c.label
        const style = chipStyleOf(c)
        const cls =
          style === 'answer'
            ? answerChipCls(chosen)
            : 'press inline-flex min-h-11 max-w-full flex-col justify-center border-0 bg-transparent px-0.5 text-left text-[15px] underline decoration-[1.5px] underline-offset-[5px] disabled:opacity-60 ' +
              (isEmphasizedAction(c)
                ? 'font-bold text-ink hover:text-mute dark:text-ink-dark dark:hover:text-mute-dark'
                : 'text-accent-ink hover:text-ink dark:text-accent-ink-dark dark:hover:text-ink-dark')
        return (
          <button
            key={c.id}
            type="button"
            data-testid={`chip-${c.id}`}
            role={single ? 'radio' : undefined}
            aria-checked={single ? chosen : undefined}
            onClick={() => onPick(c)}
            className={cls}
          >
            <span className="inline-flex items-center gap-1.5">
              {/* 색맹 안전: 채움만이 아니라 체크 아이콘으로도 "고름"을 말한다 */}
              {chosen && style === 'answer' && <CheckIcon className="h-4 w-4 shrink-0" />}
              <span className="break-keep">{c.label}</span>
            </span>
            {c.hint && (
              <span
                className={
                  'mt-0.5 text-xs break-keep no-underline ' +
                  (chosen && style === 'answer'
                    ? 'text-paper dark:text-paper-dark'
                    : 'text-mute dark:text-mute-dark')
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

  // 단일·다중 선택 질문은 답하면 잠긴다(지나간 질문의 칩으로 상태가 꼬이지 않게).
  const locked = msg.select !== 'action' && msg.id !== h.activeQuestionId

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
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-mute dark:text-mute-dark"
              >
                <CheckIcon className="h-3.5 w-3.5 text-ok dark:text-ok-dark" />
                {msg.answeredLabel} 선택함
              </p>
            )
          : done && (
              // msg-in = 버블 타이핑 완료 뒤의 fade+상승 등장(reduced-motion 에서는 비활성).
              <div data-testid="inline-chips" className="msg-in mt-2">
                {msg.select === 'multi' ? (
                  <MultiChipRow
                    chips={msg.chips}
                    ariaLabel={msg.text}
                    onPick={(c) => h.onChip(c, msg.id)}
                  />
                ) : (
                  <ChipRow
                    chips={msg.chips}
                    select={msg.select}
                    ariaLabel={msg.text}
                    answeredLabel={msg.answeredLabel}
                    onPick={(c) => h.onChip(c, msg.id)}
                  />
                )}
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

// 덱 슬라이드 공통: 둥근 카드가 아니라 2px 잉크 괘선으로 여는 섹션(B·종이 메모).
// 스냅·폭은 index.css 의 .deck-track > * 가 계속 소유한다 — 여기서는 경계만 바꾼다.
const DECK_SLIDE_CLS = 'min-w-0 border-t-2 border-ink pt-3 dark:border-ink-dark'

const ELIGIBILITY_NOTE = (
  <>
    ※ 여기 표시된 것은 <b>예상 자격</b>입니다. 최종 자격은 각 공식 신청처에서 확인됩니다.
  </>
)

// 시설 요약의 머리(구 단위 카운트 배지)와 발(나머지 안내 + 패널 열기 버튼)은
// 덱 슬라이드와 데스크톱 카드가 같은 것을 쓴다.
// FR-04 AC6(OV5): 화면에 실제로 표시한 수(잘린 목록 길이)와 구 단위 가맹 수를 분리해 적는다.
// 자격 ✗(primary='alternatives')이면 못 쓰는 가맹 숫자는 강조하지 않는다.
export function facilityCountText(req: AssessRequest, data: AssessResponse): string {
  const n = data.nearby.voucher_facilities.length
  const count = data.supply_gap.voucher_count
  if (data.nearby.primary === 'alternatives') {
    return `근처 대안 ${data.nearby.alternatives.length}곳 표시`
  }
  if (count == null) return `근처 ${n}곳 표시`
  return `근처 ${n}곳 표시 · ${req.sigungu_nm} 가맹 ${count}곳`
}

function FacilityCounts({ req, data }: { req: AssessRequest; data: AssessResponse }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {/* 이용권은 구 단위 카운트(반경 문구 금지, FR-04 AC2) */}
      <Badge tone="brand">{facilityCountText(req, data)}</Badge>
      <Badge tone="ok">
        {altPoolLabel(req.disability.has)} {data.nearby.alternatives.length}곳
      </Badge>
    </div>
  )
}

function FacilityRest({ data }: { data: AssessResponse }) {
  const restV = Math.max(0, data.nearby.voucher_facilities.length - VOUCHER_PREVIEW)
  const restA = Math.max(0, data.nearby.alternatives.length - ALT_PREVIEW)
  if (restV === 0 && restA === 0) return null
  return (
    <p className="mt-2 text-xs text-mute dark:text-mute-dark">
      나머지 {restV > 0 ? `이용권 가맹 ${restV}곳` : ''}
      {restV > 0 && restA > 0 ? ' · ' : ''}
      {restA > 0 ? `공공·대안 ${restA}곳` : ''}은 시설 목록에서 볼 수 있어요.
    </p>
  )
}

// 지도·목록 열기 = 행동 칩과 같은 밑줄 텍스트 버튼(칩 규칙과 한 벌).
const ACTION_LINK_CLS =
  'press inline-flex min-h-11 items-center border-0 bg-transparent px-0.5 text-[15px] text-accent-ink underline decoration-[1.5px] underline-offset-[5px] hover:text-ink dark:text-accent-ink-dark dark:hover:text-ink-dark'

function FacilityActions({ onOpenPanel }: { onOpenPanel: (tab: 'map' | 'list') => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-[18px] gap-y-1.5">
      <button
        type="button"
        data-testid="open-map-panel"
        onClick={() => onOpenPanel('map')}
        className={ACTION_LINK_CLS}
      >
        지도에서 보기
      </button>
      <button
        type="button"
        data-testid="open-list-panel"
        onClick={() => onOpenPanel('list')}
        className={ACTION_LINK_CLS}
      >
        시설 목록 전체 보기
      </button>
    </div>
  )
}

function EmptyFacilities() {
  return (
    <p className="mt-3 rounded-[3px] border border-rule bg-tint p-3.5 text-sm text-ink dark:border-rule-dark dark:bg-tint-dark dark:text-ink-dark">
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

// ── 히어로(6A) ──────────────────────────────────────────────────────────
// '지금 바로 되는 것' 블록은 덱 슬라이드가 아니라 `assess_result` 안 전폭 블록이다.
// 위치는 CardDeck/세로 블록보다 **앞** — 폰 390px 첫 화면에서 스와이프 없이 보여야 한다.
// 앵커(data-result-anchor)는 메시지 래퍼 그대로라 1회 오토스크롤 동작은 바뀌지 않는다.
function ResultHero({
  req,
  data,
  onStartFitness,
}: {
  req: AssessRequest
  data: AssessResponse
  onStartFitness: () => void
}) {
  const primary = data.eligibility.find((p) => p.program_id === primaryProgramId(req))
  const altEdges = data.alt_edges ?? []
  if (!primary || altRouteItems(primary, altEdges).items.length === 0) return null
  return (
    // 큰 전환 = 2px 잉크 괘선(카드·그림자 없음). 히어로가 결과에서 가장 굵은 경계다.
    <div className="mt-1 mb-3 border-t-2 border-ink pt-4 dark:border-ink-dark">
      <AltRoutesBlock card={primary} altEdges={altEdges} onStartFitness={onStartFitness} />
    </div>
  )
}

// ── 함께 받을 수 있는 것 · 구립(군립) 체육시설 감면 (2026-09-28) ──────────────────
// 시군구 조례 감면은 이용권 자격과 무관하다 — 자격 ✓ 사용자도 받는다(노원 14세 한부모 20% 등).
// 서버 최상위 public_fee 를 그린다. 대체경로(public_program)가 이미 같은 블록을 보여 주면 다시 그리지
// 않고(중복 렌더 금지), 히어로 N("지금 바로 되는 것 N가지")에도 세지 않는다. 맞는 감면이 없으면 생략.
function PublicFeeExtra({ data }: { data: AssessResponse }) {
  const pf = data.public_fee
  if (!pf || !pf.region || !pf.reductions || pf.reductions.length === 0) return null
  if ((data.alt_edges ?? []).some((e) => e.to === 'public_program')) return null
  const kind = pf.region.sigungu_nm.endsWith('군') ? '군립' : '구립'
  const title = `함께 받을 수 있는 것 · ${kind} 체육시설 감면`
  return (
    <section
      data-testid="public-fee-extra"
      aria-label={title}
      className="mt-1 mb-3 border-t border-rule pt-3 dark:border-rule-dark"
    >
      <h3 className="font-serif text-[16px] font-extrabold break-keep text-ink dark:text-ink-dark">{title}</h3>
      <p className="mt-1 mb-2 text-[12.5px] leading-[1.6] break-keep text-mute dark:text-mute-dark">
        이용권과 별개로 {pf.region.sigungu_nm} 조례의 체육시설 사용료 감면 대상에 해당해요(입력하신 내용 기준).
        실제 적용·필요 서류는 시설에 확인하세요.
      </p>
      <PublicFeeDetail a={pf} />
    </section>
  )
}

// 결과 카드 하단 인라인 강좌 3행(W1) — 패널로 점프하지 않아도 "무엇을 하면 되는지"가 보인다.
// 어느 목록을 쓰는지는 서버가 정한 nearby.primary 를 따른다(1A). 전체 목록은 패널 소관.
const INLINE_LIMIT = 3

function InlineFacilities({
  data,
  access,
  accessError,
}: {
  data: AssessResponse
  access: AccessibilityMap
  accessError?: boolean
}) {
  const altsFirst = data.nearby.primary === 'alternatives'
  const alts = data.nearby.alternatives.slice(0, INLINE_LIMIT)
  const vouchers = data.nearby.voucher_facilities.slice(0, INLINE_LIMIT)
  const rows = altsFirst ? alts : vouchers
  if (rows.length === 0) return null
  return (
    <section
      data-testid="inline-facilities"
      aria-label="근처 강좌 미리보기"
      className="mt-5 border-t border-rule pt-4 dark:border-rule-dark"
    >
      <h3 className="font-serif mb-2 text-[16px] font-extrabold text-ink dark:text-ink-dark">
        {altsFirst ? '근처 공공·대안 강좌' : '근처 이용권 가맹 강좌'} {rows.length}곳
      </h3>
      <ul className="space-y-2">
        {altsFirst
          ? alts.map((a, i) => <AltRow key={a.id} a={a} index={i + 1} />)
          : vouchers.map((v, i) => (
              <VoucherRow key={v.id} v={v} index={i + 1} accessibility={access[v.id]} accessError={accessError} />
            ))}
      </ul>
    </section>
  )
}

// ── 모바일 결과 덱 ───────────────────────────────────────────────────────
function ResultDeck({
  req,
  data,
  onOpenPanel,
  onStartFitness,
}: {
  req: AssessRequest
  data: AssessResponse
  onOpenPanel: (tab: 'map' | 'list') => void
  onStartFitness: () => void
}) {
  const { vouchers, alternatives, access, error } = usePreviewAccessibility(data)
  const primaryId = primaryProgramId(req)
  // 덱은 한 번에 한 장만 보이므로 "내 상황의 제도"가 첫 장이어야 한다
  // (비장애=스포츠강좌이용권 / 장애=장애인스포츠강좌이용권). 데스크톱은 전부 한눈에 보여 순서 유지.
  const cards = useMemo(
    () => [...data.eligibility].sort((a, b) => Number(b.program_id === primaryId) - Number(a.program_id === primaryId)),
    [data.eligibility, primaryId],
  )

  // 6A: 대체경로는 더 이상 덱 슬라이드가 아니다 — 슬라이드 수에서도 빠진다.
  // 시설 행은 각자 슬라이드가 아니라 "근처 자원" 슬라이드 하나 안의 목록이다(FR-12 AC9 "시설 요약").
  //   짧은 행마다 한 장씩 차지해 진행 표시가 "1 / 8"로 부풀던 문제(2026-09-28 보고서 스샷).
  const slides = data.eligibility.length + 1 + 1

  return (
    <section data-testid="assess-cards" aria-label="예상 자격 결과" className="space-y-2">
      {/* ★ 히어로 + 근처 강좌 3행: 덱보다 앞 = 폰 첫 화면(스와이프 0회) */}
      <ResultHero req={req} data={data} onStartFitness={onStartFitness} />
      <PublicFeeExtra data={data} />
      <InlineFacilities data={data} access={access} accessError={error} />

      <CardDeck
        testId="result-deck"
        ariaLabel={`판정 결과 카드 ${slides}장, 좌우로 이동`}
        hint={T.deckSwipe}
        count={slides}
      >
        {/* ① 제도별 판정 카드. 대체경로는 다음 슬라이드가 맡으므로 카드 안에는 넣지 않는다.
            슬라이드는 카드가 아니라 **섹션**이다 — 둥근 상자·그림자 대신 2px 잉크 괘선으로 연다. */}
        {cards.map((p) => (
          <li key={p.program_id} className={DECK_SLIDE_CLS}>
            <EligibilityCard p={p} />
          </li>
        ))}

        {/* ② 공급공백 · 커버리지 (대체경로는 덱 밖 히어로로 승격 — 6A) */}
        <li key="supply-gap" className={DECK_SLIDE_CLS}>
          <SupplyGapBanner gap={data.supply_gap} />
        </li>

        {/* ③ 근처 자원 슬라이드(카운트 + 시설 미리보기 목록 + 패널 열기) — 데스크톱 "근처 자원" 섹션과 같은 구성.
            목록 순서는 서버가 정한 nearby.primary 를 따른다(1A) — 이용권 ✗ 사용자에게 가맹시설을 먼저 보여 주지 않는다. */}
        <li key="facility-summary" className={DECK_SLIDE_CLS}>
          <section data-testid="facility-summary" aria-label="근처 자원 요약">
            <h3 className="font-serif text-[18px] font-extrabold text-ink dark:text-ink-dark">
              근처 자원
            </h3>
            <div className="mt-2">
              <FacilityCounts req={req} data={data} />
            </div>
            {vouchers.length + alternatives.length === 0 ? (
              <EmptyFacilities />
            ) : (
              <ul data-testid="deck-facility-rows" className="mt-3 space-y-2">
                {data.nearby.primary === 'alternatives'
                  ? [
                      ...alternatives.map((a) => <AltRow key={a.id} a={a} />),
                      ...vouchers.map((v) => (
                        <VoucherRow key={v.id} v={v} accessibility={access[v.id]} accessError={error} />
                      )),
                    ]
                  : [
                      ...vouchers.map((v) => (
                        <VoucherRow key={v.id} v={v} accessibility={access[v.id]} accessError={error} />
                      )),
                      ...alternatives.map((a) => <AltRow key={a.id} a={a} />),
                    ]}
              </ul>
            )}
            <FacilityRest data={data} />
            <FacilityActions onOpenPanel={onOpenPanel} />
          </section>
        </li>
      </CardDeck>

      <p className="text-xs text-mute dark:text-mute-dark">{ELIGIBILITY_NOTE}</p>
    </section>
  )
}

// ── 데스크톱(lg+) 세로 블록 — v1.6 까지의 형태 그대로 ────────────────────
function ResultBlocks({
  req,
  data,
  onOpenPanel,
  onStartFitness,
}: {
  req: AssessRequest
  data: AssessResponse
  onOpenPanel: (tab: 'map' | 'list') => void
  onStartFitness: () => void
}) {
  const { vouchers, alternatives, access, error } = usePreviewAccessibility(data)
  const cards = vouchers.length + alternatives.length

  return (
    <div className="space-y-4">
      {/* 6A: 히어로는 카드 그리드보다 앞(같은 메시지 안 전폭 블록) */}
      <ResultHero req={req} data={data} onStartFitness={onStartFitness} />
      <PublicFeeExtra data={data} />

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
              <EligibilityCard p={p} />
            </li>
          ))}
        </CardCarousel>
        <p className="text-xs text-mute dark:text-mute-dark">{ELIGIBILITY_NOTE}</p>
        {/* 결과 카드 하단 인라인 강좌 3행 — 전체 목록은 오른쪽 패널이 계속 소유한다 */}
        <InlineFacilities data={data} access={access} accessError={error} />
      </section>

      <SupplyGapBanner gap={data.supply_gap} />

      <section
        data-testid="facility-summary"
        aria-label="근처 자원 요약"
        className="border-t-2 border-ink pt-4 dark:border-ink-dark"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-serif text-[18px] font-extrabold text-ink dark:text-ink-dark">
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
              {/* 1A: 이용권 ✗ 면 대안이 먼저다(서버가 정한 nearby.primary) */}
              {data.nearby.primary === 'alternatives'
                ? [
                    ...alternatives.map((a) => <AltRow key={a.id} a={a} />),
                    ...vouchers.map((v) => (
                      <VoucherRow key={v.id} v={v} accessibility={access[v.id]} accessError={error} />
                    )),
                  ]
                : [
                    ...vouchers.map((v) => (
                      <VoucherRow key={v.id} v={v} accessibility={access[v.id]} accessError={error} />
                    )),
                    ...alternatives.map((a) => <AltRow key={a.id} a={a} />),
                  ]}
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

// 히어로 CTA 는 후속 칩 "체력 처방 시작"과 **같은 액션**을 태운다(새 진입로 금지, FR-02 AC5).
const HERO_FITNESS_CHIP: Chip = {
  id: 'act-fitness-hero',
  label: '체력 처방 시작',
  action: { kind: 'start_fitness' },
}

function AssessResult({ msg, h }: { msg: AssessResultMsg; h: MessageHandlers }) {
  const wide = useIsWide()
  const onStartFitness = useCallback(() => h.onChip(HERO_FITNESS_CHIP, msg.id), [h, msg.id])
  return wide ? (
    <ResultBlocks
      req={msg.req}
      data={msg.data}
      onOpenPanel={h.onOpenPanel}
      onStartFitness={onStartFitness}
    />
  ) : (
    <ResultDeck
      req={msg.req}
      data={msg.data}
      onOpenPanel={h.onOpenPanel}
      onStartFitness={onStartFitness}
    />
  )
}

// 화자 발화 버블(FR-12 AC10 타이프라이터 적용 대상은 여기 본문 텍스트뿐이다 —
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
              'mt-2 text-[12.5px] leading-[1.6] break-words whitespace-pre-line text-mute transition-opacity duration-200 ease-out dark:text-mute-dark ' +
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
                  className={ACTION_LINK_CLS}
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

// ── FAQ 카드(확인된 답변) ────────────────────────────────────────────────
// 기본형: 질문 + 답변 원문 + 출처·확인일 (칩 FAQ · answer 없는 라우팅의 폴백).
// 컴팩트형(v1.9 · FR-13 AC9): 접지 답변 버블 바로 아래 붙는 "출처 카드".
//   본문은 위 버블의 answer 가 이미 말했으므로 접어 두고(원문 확인은 언제든 가능),
//   펼쳐 두는 것은 질문 제목과 출처·확인일뿐이다 — 같은 내용이 두 번 읽히지 않게.
function FaqAnswerCard({ msg }: { msg: FaqAnswerMsg }) {
  const compact = msg.compact === true
  const body = (
    // 답변 원문의 줄바꿈을 그대로 살린다(선정순위 5줄 리스트 등 — 서버 사전이 \n 을 담는다)
    <p
      data-testid="faq-answer-body"
      className={
        'whitespace-pre-line break-words leading-[1.65] text-ink dark:text-ink-dark ' +
        (compact ? 'mt-2 text-sm' : 'mt-2 text-base')
      }
    >
      {msg.entry.answer}
    </p>
  )

  return (
    <section
      data-testid="faq-answer"
      data-compact={compact ? 'true' : 'false'}
      className={
        'border-t border-rule dark:border-rule-dark ' + (compact ? 'pt-3' : 'pt-4')
      }
    >
      <p className="font-serif flex items-start gap-1.5 text-[16px] font-extrabold text-ink dark:text-ink-dark">
        <InfoIcon className="mt-1 h-4 w-4 shrink-0 text-mute dark:text-mute-dark" />
        {msg.entry.q}
      </p>

      {compact ? (
        <details data-testid="faq-answer-fold" className="mt-1">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs text-accent-ink underline decoration-dotted underline-offset-[5px] dark:text-accent-ink-dark">
            확인된 답변 원문 보기
          </summary>
          {body}
        </details>
      ) : (
        body
      )}

      <p
        className={
          'border-t border-rule text-xs text-mute dark:border-rule-dark dark:text-mute-dark ' +
          (compact ? 'mt-2 pt-2' : 'mt-3 pt-2')
        }
      >
        <span className="tracking-[0.12em]">출처</span>{' '}
        <a
          href={msg.entry.source_url}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-dotted underline-offset-2"
        >
          {msg.entry.source_url}
        </a>{' '}
        · <KeepDates text={`확인일 ${msg.entry.checked}`} />
      </p>
    </section>
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
  // 3A: 데모 페르소나 프리필(코드→값). 폼이 마운트될 때 씨앗으로만 쓴다.
  fitnessPrefill?: Record<string, number> | null
  // W2: 자동재생이 PAR-Q 를 프리셋으로 통과시켰는가 → 게이트 카드에 그 사실을 표기한다.
  parqPreset?: boolean
}

export function MessageView({
  msg,
  h,
  showSender = true,
  typing = false,
}: {
  msg: ChatMessage
  h: MessageHandlers
  // 연속된 화자 발화 묶음의 첫 메시지에서만 아바타·이름을 보여 준다.
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
          <AssessResult msg={msg} h={h} />
        </BotLane>
      )

    // ── 체력 레인 3턴 ────────────────────────────────────────────────
    case 'fitness_parq':
      return (
        <BotLane showSender={showSender}>
          <ParqGate
            done={h.fitness.parqOk && msg.laneId === h.fitness.laneId}
            locked={msg.laneId !== h.fitness.laneId}
            preset={h.parqPreset === true && msg.laneId === h.fitness.laneId}
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
            initialValues={h.fitnessPrefill}
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
          <FaqAnswerCard msg={msg} />
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

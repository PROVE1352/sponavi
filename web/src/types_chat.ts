// v2 챗 UI 타입. docs/API.md `/api/chat/*` 계약 + 클라 대화 상태기계(FR-12)의 형태.
// ★ types.ts(assess 계약, 타 에이전트 소유 관례)를 건드리지 않도록 챗 타입은 이 파일에 격리한다.

import type {
  AlternativeFacility,
  AssessRequest,
  AssessResponse,
  DisabilityType,
  FitnessAiResponse,
  FitnessItem,
  FitnessResponse,
  IncomeClass,
  Nearby,
  PathEdge,
  Sex,
  SupplyGap,
  VoucherFacility,
} from './types'
import type { AppError } from './components/ErrorPanel'

// ────────────────────────────── 대화 슬롯 ──────────────────────────────

// AssessRequest 의 부분형(수집 중 상태). 전부 채워지면 판정 요청을 만든다.
export interface ChatSlots {
  age: number | null
  sex: Sex | null
  sigungu_cd: string | null
  sigungu_nm: string | null
  income_class: IncomeClass | null
  // "잘 모르겠어요"(FR-01 AC3 계승 · FR-12 AC6): 판정은 가장 보수적인 '그외'로 하되
  // 결과에 "기초·차상위 확인 방법" 안내를 덧붙인다. 서버로 전송되는 필드가 아니다.
  income_unknown: boolean
  disability_has: boolean | null
  disability_type: DisabilityType | null
}

export const EMPTY_SLOTS: ChatSlots = {
  age: null,
  sex: null,
  sigungu_cd: null,
  sigungu_nm: null,
  income_class: null,
  income_unknown: false,
  disability_has: null,
  disability_type: null,
}

// 대화 단계. NLU 요청에 실리는 값은 collect|fitness|qa (API.md).
export type ChatPhase = 'greet' | 'collect' | 'assessed' | 'fitness' | 'qa'
export type NluPhase = 'collect' | 'fitness' | 'qa'

// ────────────────────────────── POST /api/chat/nlu ──────────────────────────────

// 전송되는 슬롯 상태(범주화된 현재 값만 — 대화 이력 전문은 보내지 않는다, ARCHITECTURE §11.3).
export interface NluSlotsWire {
  age: number | null
  sex: Sex | null
  sigungu_cd: string | null
  income_class: IncomeClass | null
  disability: { has: boolean | null; type: DisabilityType | null }
}

export interface ChatNluRequest {
  text: string
  slots: NluSlotsWire
  phase: NluPhase
}

export type ChatIntent =
  | 'provide_info'
  | 'ask_faq'
  | 'start_fitness'
  | 'show_map'
  | 'restart'
  | 'unknown'

export interface RegionCandidate {
  cd: string
  nm: string
}

// 서버가 pydantic 검증을 통과시킨 갱신분만 담는다. 클라도 한 번 더 방어 검증한다.
export interface NluSlotUpdates {
  age?: number | null
  sex?: Sex | null
  sigungu_cd?: string | null
  sigungu_nm?: string | null
  income_class?: IncomeClass | null
  disability?: { has?: boolean | null; type?: DisabilityType | null } | null
}

export interface ChatNluResponse {
  slot_updates: NluSlotUpdates
  intent: ChatIntent
  faq_key: string | null
  region_candidates: RegionCandidate[]
  // 후필터 통과분만. 폐기·폴백 시 null → 클라는 템플릿 발화를 쓴다.
  reply: string | null
  provider: 'openai' | 'rules' | string
}

// ────────────────────────────── GET /api/chat/faq ──────────────────────────────

export interface FaqEntry {
  key: string
  q: string
  answer: string
  source_url: string
  checked: string
}

// ────────────────────────────── 칩(버튼) ──────────────────────────────

export type QuestionId = 'greet' | 'age' | 'sex' | 'region' | 'income' | 'disability' | 'disability_type'

// 칩 1개가 하는 일. 칩 입력은 외부 API로 전송되지 않는다(FR-12 AC7).
export type ChipAction =
  | { kind: 'answer'; question: QuestionId; slots: Partial<ChatSlots> }
  | { kind: 'persona'; personaId: string }
  | { kind: 'manual_start' }
  | { kind: 'edit'; question: QuestionId }
  | { kind: 'faq'; faqKey: string }
  | { kind: 'open_panel'; tab: PanelTab }
  | { kind: 'start_fitness' }
  | { kind: 'restart'; step: 'ask' | 'yes' | 'no' }

export interface Chip {
  id: string
  label: string
  hint?: string
  action: ChipAction
}

// ────────────────────────────── 메시지 ──────────────────────────────

export type PanelTab = 'map' | 'list'

interface MsgBase {
  id: string
  role: 'user' | 'bot'
}

export type BotTone = 'plain' | 'notice'

export interface UserTextMsg extends MsgBase {
  role: 'user'
  kind: 'user_text'
  text: string
}

export interface BotTextMsg extends MsgBase {
  role: 'bot'
  kind: 'bot_text'
  text: string
  // 같은 버블 안의 보조 한 줄(뮤트 톤). 인사 버블의 비저장·외부 전송 고지처럼
  // "본문보다 작게, 그러나 항상 보이게" 두어야 하는 문장에 쓴다(FR-12 AC7 v1.4).
  sub?: string
  tone: BotTone
  // 목록형 보조 문장(안내 블록 등). 사실 문장은 전부 템플릿·엔진 출력이다(FR-12 AC2).
  bullets?: string[]
  links?: { label: string; url: string }[]
}

export interface ChipQuestionMsg extends MsgBase {
  role: 'bot'
  kind: 'chip_question'
  question: QuestionId
  text: string
  chips: Chip[]
  // single = 단일 선택 그룹(radiogroup) · action = 즉시 실행 버튼 그룹
  select: 'single' | 'action'
  // inline = 메시지 안에서 렌더(정정 칩·후보 재질문) · false = 컴포저 칩 영역에서 렌더
  inline: boolean
  // 지역 질문은 검색 가능 선택(FR-12 AC6) — 컴포저가 검색창을 함께 렌더한다.
  searchable?: boolean
  answeredLabel?: string
}

export interface AssessCardsMsg extends MsgBase {
  role: 'bot'
  kind: 'assess_cards'
  req: AssessRequest
  data: AssessResponse
}

export interface SupplyGapMsg extends MsgBase {
  role: 'bot'
  kind: 'supply_gap'
  gap: SupplyGap
}

export interface PathMsg extends MsgBase {
  role: 'bot'
  kind: 'path'
  path: PathEdge[]
}

export interface FacilitySummaryMsg extends MsgBase {
  role: 'bot'
  kind: 'facility_summary'
  sigunguNm: string
  vouchers: VoucherFacility[]
  alternatives: AlternativeFacility[]
  totalVouchers: number
  totalAlternatives: number
}

// ── 체력 레인 3턴(FR-07~09를 챗 대화 턴으로 분해) ──────────────────────────
//   턴1 fitness_parq  : PAR-Q 문진 게이트(통과해야 다음 턴, FR-07 AC5)
//   턴2 fitness_form  : 연령군 동적 측정 폼(FR-07 AC1~3·AC6)
//   턴3 fitness_result: 판정·추천·AI 처방 카드(FR-08·09)
// laneId = 레인 회차. 새 판정(=다른 상황)으로 갈아타면 지난 턴 메시지는 기록으로만 남는다.

export interface FitnessParqMsg extends MsgBase {
  role: 'bot'
  kind: 'fitness_parq'
  laneId: number
}

export interface FitnessFormMsg extends MsgBase {
  role: 'bot'
  kind: 'fitness_form'
  laneId: number
}

export interface FitnessResultMsg extends MsgBase {
  role: 'bot'
  kind: 'fitness_result'
  laneId: number
  // 결과는 메시지에 고정한다(대화 기록의 사실은 나중에 바뀌지 않는다).
  result: FitnessResponse
  nearby: Nearby
}

export interface ErrorMsg extends MsgBase {
  role: 'bot'
  kind: 'error'
  error: AppError
}

export interface FaqAnswerMsg extends MsgBase {
  role: 'bot'
  kind: 'faq_answer'
  entry: FaqEntry
}

export type ChatMessage =
  | UserTextMsg
  | BotTextMsg
  | ChipQuestionMsg
  | AssessCardsMsg
  | SupplyGapMsg
  | PathMsg
  | FacilitySummaryMsg
  | FitnessParqMsg
  | FitnessFormMsg
  | FitnessResultMsg
  | ErrorMsg
  | FaqAnswerMsg

// ────────────────────────────── 체력 레인 계약 ──────────────────────────────

// 동적 폼 한 행: 단일 항목 / alt_group 택1(셀렉트+입력 한 슬롯, FR-07 AC1).
export type FitnessFormRow =
  | { kind: 'single'; item: FitnessItem }
  | { kind: 'alt'; altGroup: string; factor: string; options: FitnessItem[] }

// useFitness() 가 소유하는 레인 상태·액션. 뷰 3분할은 이 계약만 보고 순수 렌더한다.
// ★ PAR-Q 응답은 여기 없다 — 게이트 컴포넌트의 로컬 상태이며 저장·전송되지 않는다(P-3).
export interface FitnessLaneApi {
  itemsLoading: boolean
  itemsError: boolean
  reloadItems: () => void
  // 만 7~10 공백 고지(FR-07 AC6). null 이면 배너 없음.
  gapMessage: string | null
  // 등급 판정 항목이 없는 연령군(유아) 안내. null 이면 폼을 그린다.
  emptyMessage: string | null
  grouped: [string, FitnessFormRow[]][]
  submitting: boolean
  submitError: AppError | null
  ai: FitnessAiResponse | null
  aiLoading: boolean
  aiError: AppError | null
  requestAi: () => void
  cancelAi: () => void
}

// 메시지 렌더러가 받는 체력 턴 계약 = 레인 상태 + 턴 진행 액션.
export interface FitnessTurnApi extends FitnessLaneApi {
  laneId: number
  parqOk: boolean
  // 마지막 결과 메시지 id — AI 처방 조작부는 최신 결과 카드에만 붙는다.
  resultMsgId: string | null
  onParqContinue: () => void
  onSubmit: (measures: Record<string, number>) => void
}

// ────────────────────────────── 스토어 상태 ──────────────────────────────

export type LlmMode = 'llm' | 'chips'

// 체력 레인 진행 상태(대화 턴의 진행도만 — 측정값·문진 응답은 여기 없다).
export interface FitnessLaneState {
  // 레인 회차. 새 판정마다 증가 → 지난 회차의 턴 메시지는 기록으로 잠긴다.
  laneId: number
  active: boolean
  parqOk: boolean
  resultMsgId: string | null
}

export interface ChatState {
  messages: ChatMessage[]
  slots: ChatSlots
  phase: ChatPhase
  panel: { open: boolean; tab: PanelTab }
  // 체력 처방 → 근처 자원 종목 필터(구 ResultView 소유분 이주).
  filterSports?: string[]
  llmMode: LlmMode
  lastAssess: { req: AssessRequest; data: AssessResponse } | null
  // 컴포저가 칩을 그릴 현재 질문(메시지 id). 없으면 자유 입력만.
  activeQuestionId: string | null
  pending: boolean
  activePersonaId: string | null
  // 체력 레인(3턴) 진행 상태.
  fitness: FitnessLaneState
  faq: FaqEntry[]
}

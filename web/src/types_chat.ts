// v2 챗 UI 타입. docs/API.md `/api/chat/*` 계약 + 클라 대화 상태기계(FR-12)의 형태.
// ★ types.ts(assess 계약, 타 에이전트 소유 관례)를 건드리지 않도록 챗 타입은 이 파일에 격리한다.

import type {
  AlternativeFacility,
  AssessRequest,
  AssessResponse,
  DisabilityType,
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

export interface FitnessBlockMsg extends MsgBase {
  role: 'bot'
  kind: 'fitness_block'
  age: number
  sex: Sex
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
  | FitnessBlockMsg
  | ErrorMsg
  | FaqAnswerMsg

// ────────────────────────────── 스토어 상태 ──────────────────────────────

export type LlmMode = 'llm' | 'chips'

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
  // 체력 블록 전개 신호(intent=start_fitness). 증가할 때마다 블록이 열린다.
  fitnessOpenSignal: number
  faq: FaqEntry[]
}

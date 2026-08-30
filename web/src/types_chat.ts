// v2 챗 UI 타입. docs/API.md `/api/chat/*` 계약 + 클라 대화 상태기계(FR-12)의 형태.
// ★ types.ts(assess 계약, 타 에이전트 소유 관례)를 건드리지 않도록 챗 타입은 이 파일에 격리한다.

import type {
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
} from './types'
import type { AppError } from './components/ErrorPanel'

// ────────────────────────────── 대화 슬롯 ──────────────────────────────

// AssessRequest 의 부분형(수집 중 상태). 전부 채워지면 판정 요청을 만든다.
export interface ChatSlots {
  age: number | null
  // 연령 2단계 칩의 1단계 결과(FR-12 AC6 v1.5). 판정에는 절대 쓰이지 않는다 —
  // 구간 대표값 추정 금지(P-1). 오직 "어떤 세부 나이 칩을 보여줄지"만 정한다.
  age_band: string | null
  sex: Sex | null
  // 지역 2단계 칩의 1단계 결과(FR-12 AC1 v1.7) = 시도 코드 2자리(시군구 코드의 앞 2자리).
  // 판정에는 쓰이지 않는다 — "어떤 시군구 칩을 보여줄지"만 정한다(연령대와 같은 역할).
  sido_cd: string | null
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
  age_band: null,
  sex: null,
  sido_cd: null,
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
  // FR-08 AC8: 처방 근거를 묻는 의도("왜 이 운동 추천했어?"). 규칙 NLU 가 먼저 잡는다.
  | 'why_exercise'
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
  // 접지 답변(v1.9 · FR-13 AC9). 재료는 서버가 주입한 검증 텍스트(FAQ 사전 전문)뿐이고
  // fact-lock 후필터를 통과한 것만 온다 — 폐기·비질문·폴백 시 null(기존 faq_key 카드로 폴백).
  // reply(공감·전환 한 줄)와 역할이 다르다: answer 가 있으면 그것이 본문이고 reply 는 쓰지 않는다.
  answer: string | null
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

export type QuestionId =
  | 'greet'
  // age_band = 연령대(1단계) · age = 그 구간의 세부 나이(2단계, FR-12 AC6 v1.5)
  | 'age_band'
  | 'age'
  | 'sex'
  // region_sido = 시도(1단계) · region = 그 시도의 시군구(2단계, FR-12 AC1 v1.7)
  | 'region_sido'
  | 'region'
  | 'income'
  | 'disability'
  | 'disability_type'

// 칩 1개가 하는 일. 칩 입력은 외부 API로 전송되지 않는다(FR-12 AC7).
export type ChipAction =
  | { kind: 'answer'; question: QuestionId; slots: Partial<ChatSlots> }
  | { kind: 'persona'; personaId: string }
  | { kind: 'manual_start' }
  | { kind: 'edit'; question: QuestionId }
  | { kind: 'faq'; faqKey: string }
  | { kind: 'open_panel'; tab: PanelTab }
  | { kind: 'start_fitness' }
  // FR-08 AC8: 처방 근거를 채팅으로 묻는다(결과 카드의 항목별 근거 블록을 대신한다).
  | { kind: 'why_exercise' }
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
  // single = 단일 선택 그룹(radiogroup, 답하면 잠김) · action = 즉시 실행 버튼 그룹(계속 살아 있음)
  select: 'single' | 'action'
  answeredLabel?: string
}

// 판정 결과 한 덩어리(v1.7). 이전의 assess_cards + supply_gap + facility_summary 세 메시지를
// 하나로 합친 것 — 모바일(<lg)에서는 가로 스와이프 결과 덱, 데스크톱(lg+)에서는 기존 세로 블록으로
// 같은 내용을 그린다(FR-12 AC9 v1.7). 결과가 세로 버블 여러 개로 쌓이지 않게 하는 것이 요점이다.
export interface AssessResultMsg extends MsgBase {
  role: 'bot'
  kind: 'assess_result'
  req: AssessRequest
  data: AssessResponse
}

export interface PathMsg extends MsgBase {
  role: 'bot'
  kind: 'path'
  path: PathEdge[]
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
  // 컴팩트 출처 카드(v1.9 · FR-13 AC9): 접지 답변(answer) 버블 아래에 붙는 형태.
  // 본문은 answer 가 이미 말했으므로 질문 제목 + 출처·확인일만 펴 두고 원문은 접어 둔다.
  compact?: boolean
}

export type ChatMessage =
  | UserTextMsg
  | BotTextMsg
  | ChipQuestionMsg
  | AssessResultMsg
  | PathMsg
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

// 등장 큐 진행도(연출 전용 — 대화 사실은 여기 없다).
export interface RevealState {
  revealed: number
  settled: boolean
}

export interface ChatState {
  messages: ChatMessage[]
  slots: ChatSlots
  phase: ChatPhase
  panel: { open: boolean; tab: PanelTab }
  // "패널을 **봐야만 하는**" 요청이 몇 번 있었는가. 이 카운터가 오를 때마다 셸이 모바일(<lg)에서
  // 패널로 부드럽게 스크롤한다(데스크톱은 옆 열이라 옮길 것이 없다).
  // ★ 2026-08-30: 지도/목록 버튼·칩·처방 필터는 더 이상 여기 오지 않는다 — 패널만 열고
  //   화면은 대화 바닥에 남긴다(그쪽으로 끌고 가면 방금 붙은 답과 액션 칩이 화면 밖으로 밀렸다).
  //   지금 이 경로를 쓰는 것은 "시설 목록에서 시설 누르기"(지도 확대) 하나뿐이다.
  panelFocus: number
  // 체력 처방 → 근처 자원 종목 필터(구 ResultView 소유분 이주).
  filterSports?: string[]
  llmMode: LlmMode
  lastAssess: { req: AssessRequest; data: AssessResponse } | null
  // 지금 열려 있는 질문(메시지 id). 이 질문의 칩만 살아 있고, 지나간 질문의 칩은
  // 선택 표시만 남기고 사라진다(FR-12 AC1 v1.6 — 과거 칩 클릭으로 상태가 꼬이는 경로 차단).
  activeQuestionId: string | null
  pending: boolean
  activePersonaId: string | null
  // 체력 레인(3턴) 진행 상태.
  fitness: FitnessLaneState
  // 순차 등장 큐(ChatStream useRevealQueue)의 진행도 브리지(W2 자동재생).
  //   revealed = 지금까지 연 버블 수 · settled = 연출이 다 끝났는가
  // 자동재생이 "앞 단계 UI 가 실제로 그려졌는가"를 DOM 폴링 없이 알기 위한 유일한 신호다.
  reveal: RevealState
  faq: FaqEntry[]
}

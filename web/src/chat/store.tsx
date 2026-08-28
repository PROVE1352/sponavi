// 챗 상태 스토어: useReducer + Context (신규 npm 의존성 없음, ARCHITECTURE §11.4).
// 대화 상태(messages·slots·phase)는 전부 클라이언트 메모리에만 둔다 —
// localStorage/sessionStorage 저장 금지(P-3 비저장).

import { createContext, useContext, useMemo, useReducer } from 'react'
import type { Dispatch, ReactNode } from 'react'
import type { AssessRequest, AssessResponse } from '../types'
import type {
  ChatMessage,
  ChatSlots,
  ChatState,
  ChatPhase,
  FaqEntry,
  LlmMode,
  PanelTab,
} from '../types_chat'
import { EMPTY_SLOTS } from '../types_chat'

export const INITIAL_STATE: ChatState = {
  messages: [],
  slots: { ...EMPTY_SLOTS },
  phase: 'greet',
  panel: { open: false, tab: 'map' },
  panelFocus: 0,
  filterSports: undefined,
  llmMode: 'llm',
  lastAssess: null,
  activeQuestionId: null,
  pending: false,
  activePersonaId: null,
  fitness: { laneId: 0, active: false, parqOk: false, resultMsgId: null },
  reveal: { revealed: 0, settled: false },
  faq: [],
}

export type ChatAction =
  | { type: 'push'; messages: ChatMessage[] }
  | { type: 'replaceLast'; message: ChatMessage }
  | { type: 'setActiveQuestion'; id: string | null }
  | { type: 'answerQuestion'; id: string; label: string }
  | { type: 'patchSlots'; slots: Partial<ChatSlots> }
  | { type: 'resetSlots' }
  | { type: 'setSlots'; slots: ChatSlots }
  | { type: 'setPhase'; phase: ChatPhase }
  | { type: 'setPending'; pending: boolean }
  | { type: 'setLlmMode'; mode: LlmMode }
  // focus = "패널을 봐 달라"는 명시적 요청(지도·목록 버튼/칩) — 셸이 패널로 스크롤한다.
  | { type: 'setPanel'; open?: boolean; tab?: PanelTab; focus?: boolean }
  | { type: 'setFilterSports'; sports?: string[] }
  | { type: 'setAssess'; req: AssessRequest; data: AssessResponse }
  | { type: 'setPersona'; id: string | null }
  // 체력 레인 3턴: 시작 → PAR-Q 통과 → 결과 턴 게시
  | { type: 'fitnessStart' }
  | { type: 'fitnessParqOk' }
  | { type: 'fitnessResult'; msgId: string }
  // 등장 큐 브리지(W2): ChatStream 이 "몇 개 열었고 연출이 끝났는지"를 스토어로 올린다.
  | { type: 'setReveal'; revealed: number; settled: boolean }
  | { type: 'setFaq'; faq: FaqEntry[] }
  | { type: 'reset'; keep: { llmMode: LlmMode; faq: FaqEntry[] } }

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'push':
      return { ...state, messages: [...state.messages, ...action.messages] }
    case 'replaceLast':
      return { ...state, messages: [...state.messages.slice(0, -1), action.message] }
    case 'setActiveQuestion':
      return { ...state, activeQuestionId: action.id }
    case 'answerQuestion':
      return {
        ...state,
        activeQuestionId: state.activeQuestionId === action.id ? null : state.activeQuestionId,
        messages: state.messages.map((m) =>
          m.id === action.id && m.kind === 'chip_question'
            ? { ...m, answeredLabel: action.label }
            : m,
        ),
      }
    case 'patchSlots':
      return { ...state, slots: { ...state.slots, ...action.slots } }
    case 'resetSlots':
      return { ...state, slots: { ...EMPTY_SLOTS } }
    case 'setSlots':
      return { ...state, slots: action.slots }
    case 'setPhase':
      return { ...state, phase: action.phase }
    case 'setPending':
      return { ...state, pending: action.pending }
    case 'setLlmMode':
      return { ...state, llmMode: action.mode }
    case 'setPanel':
      return {
        ...state,
        panel: {
          open: action.open ?? state.panel.open,
          tab: action.tab ?? state.panel.tab,
        },
        panelFocus: action.focus ? state.panelFocus + 1 : state.panelFocus,
      }
    case 'setFilterSports':
      return { ...state, filterSports: action.sports }
    case 'setAssess':
      // 새 판정 = 다른 상황. 진행 중이던 체력 레인은 닫고 회차를 넘긴다
      // (지난 턴 메시지는 기록으로 남되 더 이상 조작되지 않는다).
      return {
        ...state,
        lastAssess: { req: action.req, data: action.data },
        // 결과 도착 → 컨텍스트 패널 자동 표시(FR-12 AC3 v1.4).
        // 데스크톱은 원래 상시 노출이고, 모바일에서 이게 "상단 시트가 내려오는" 동작이 된다.
        panel: { ...state.panel, open: true },
        fitness: { laneId: state.fitness.laneId + 1, active: false, parqOk: false, resultMsgId: null },
      }
    case 'setPersona':
      return { ...state, activePersonaId: action.id }
    case 'fitnessStart':
      return {
        ...state,
        fitness: { laneId: state.fitness.laneId + 1, active: true, parqOk: false, resultMsgId: null },
      }
    case 'fitnessParqOk':
      return { ...state, fitness: { ...state.fitness, parqOk: true } }
    case 'fitnessResult':
      return { ...state, fitness: { ...state.fitness, resultMsgId: action.msgId } }
    case 'setReveal':
      // 값이 그대로면 같은 객체를 돌려준다 — 연출 신호 때문에 트리가 다시 그려지지 않게.
      if (state.reveal.revealed === action.revealed && state.reveal.settled === action.settled) {
        return state
      }
      return { ...state, reveal: { revealed: action.revealed, settled: action.settled } }
    case 'setFaq':
      return { ...state, faq: action.faq }
    case 'reset':
      return { ...INITIAL_STATE, llmMode: action.keep.llmMode, faq: action.keep.faq }
  }
}

interface ChatStore {
  state: ChatState
  dispatch: Dispatch<ChatAction>
}

const ChatContext = createContext<ChatStore | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, INITIAL_STATE)
  const value = useMemo(() => ({ state, dispatch }), [state])
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatStore {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat 는 <ChatProvider> 안에서만 사용할 수 있습니다')
  return ctx
}

// 메시지 id 생성기(렌더 순수성 유지를 위해 모듈 카운터 사용 — 저장·전송되지 않는다).
let seq = 0
export function nextId(prefix = 'm'): string {
  seq += 1
  return `${prefix}${seq}`
}

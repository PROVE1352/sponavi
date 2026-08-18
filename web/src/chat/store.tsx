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
  filterSports: undefined,
  llmMode: 'llm',
  lastAssess: null,
  activeQuestionId: null,
  pending: false,
  activePersonaId: null,
  fitnessOpenSignal: 0,
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
  | { type: 'setPanel'; open?: boolean; tab?: PanelTab }
  | { type: 'setFilterSports'; sports?: string[] }
  | { type: 'setAssess'; req: AssessRequest; data: AssessResponse }
  | { type: 'setPersona'; id: string | null }
  | { type: 'openFitness' }
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
      }
    case 'setFilterSports':
      return { ...state, filterSports: action.sports }
    case 'setAssess':
      return { ...state, lastAssess: { req: action.req, data: action.data } }
    case 'setPersona':
      return { ...state, activePersonaId: action.id }
    case 'openFitness':
      return { ...state, fitnessOpenSignal: state.fitnessOpenSignal + 1 }
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

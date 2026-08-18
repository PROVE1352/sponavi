// 대화 오케스트레이션. 정책(policy.ts)이 "무엇을 말할지"를, 여기서 "언제 어떻게"를 담당한다.
//
//   칩 입력  → 슬롯 직접 갱신 · LLM 0회 · 챗 엔드포인트 무호출(ARCHITECTURE §11.1)
//   자유 텍스트 → POST /api/chat/nlu (목모드·실패·provider=rules 면 칩 모드로 강등)
//   슬롯 완성 → POST /api/assess → 카드 메시지들
//
// 저장 금지(P-3): 슬롯·대화는 메모리에만 둔다. localStorage/sessionStorage 미사용.

import { useCallback, useEffect, useRef, useState } from 'react'
import { assess, chatFaq, chatNlu, getPersonas, getSigungu, useMockData } from '../api/client'
import type {
  AssessRequest,
  DemoPersona,
  DisabilityType,
  IncomeClass,
  Sex,
  Sigungu,
} from '../types'
import type {
  ChatMessage,
  ChatSlots,
  Chip,
  NluPhase,
  NluSlotsWire,
  PanelTab,
  QuestionId,
} from '../types_chat'
import { toAppError } from '../components/ErrorPanel'
import { nextId, useChat } from './store'
import {
  DISABILITY_TYPES,
  INCOME_OPTIONS,
  REGION_AMBIGUOUS_PROMPT,
  SLOT_ECHO_PROMPT,
  T,
  answerEcho,
  facilitySummaryText,
  followUpChips,
  nextQuestion,
  personaEchoText,
  questionSpec,
  regionCandidateChips,
  restartConfirmChips,
  slotEditChips,
  slotsFromRequest,
  toAssessRequest,
  verdictText,
} from './policy'

const INCOME_VALUES = INCOME_OPTIONS.map((o) => o.value)

function botText(
  text: string,
  opts: { tone?: 'plain' | 'notice'; bullets?: string[]; links?: { label: string; url: string }[] } = {},
): ChatMessage {
  return {
    id: nextId('b'),
    role: 'bot',
    kind: 'bot_text',
    text,
    tone: opts.tone ?? 'plain',
    bullets: opts.bullets,
    links: opts.links,
  }
}

function userText(text: string): ChatMessage {
  return { id: nextId('u'), role: 'user', kind: 'user_text', text }
}

function nluPhaseOf(phase: string): NluPhase {
  if (phase === 'fitness') return 'fitness'
  if (phase === 'assessed' || phase === 'qa') return 'qa'
  return 'collect'
}

// 전송되는 슬롯: 현재 범주값만(대화 이력 전문 미전송, ARCHITECTURE §11.3).
function toWire(s: ChatSlots): NluSlotsWire {
  return {
    age: s.age,
    sex: s.sex,
    sigungu_cd: s.sigungu_cd,
    income_class: s.income_class,
    disability: { has: s.disability_has, type: s.disability_type },
  }
}

export function useChatController() {
  const { state, dispatch } = useChat()
  const [sigungu, setSigungu] = useState<Sigungu[]>([])
  const [personas, setPersonas] = useState<DemoPersona[]>([])
  const lastAttempt = useRef<AssessRequest | null>(null)
  const booted = useRef(false)

  const push = useCallback(
    (...messages: ChatMessage[]) => dispatch({ type: 'push', messages }),
    [dispatch],
  )

  // ── 질문 던지기 ──────────────────────────────────────────────
  const askQuestion = useCallback(
    (q: QuestionId, list: Sigungu[] = sigungu, ps: DemoPersona[] = personas) => {
      const spec = questionSpec(q, { sigungu: list, personas: ps })
      const id = nextId('q')
      push({
        id,
        role: 'bot',
        kind: 'chip_question',
        question: spec.question,
        text: spec.text,
        chips: spec.chips,
        select: spec.select,
        searchable: spec.searchable,
        inline: false,
      })
      dispatch({ type: 'setActiveQuestion', id })
    },
    [dispatch, personas, push, sigungu],
  )

  // ── 판정 실행 ────────────────────────────────────────────────
  const runAssess = useCallback(
    async (req: AssessRequest) => {
      lastAttempt.current = req
      dispatch({ type: 'setActiveQuestion', id: null })
      dispatch({ type: 'setPending', pending: true })
      try {
        const data = await assess(req)
        dispatch({ type: 'setAssess', req, data })
        dispatch({ type: 'setPhase', phase: 'assessed' })
        const gap = data.supply_gap
        const followUp = followUpChips(state.faq.map((f) => ({ key: f.key, q: f.q })))
        push(
          botText(verdictText(req, data)),
          { id: nextId('p'), role: 'bot', kind: 'path', path: data.path },
          { id: nextId('e'), role: 'bot', kind: 'assess_cards', req, data },
          { id: nextId('g'), role: 'bot', kind: 'supply_gap', gap },
          botText(facilitySummaryText()),
          {
            id: nextId('f'),
            role: 'bot',
            kind: 'facility_summary',
            sigunguNm: req.sigungu_nm,
            vouchers: data.nearby.voucher_facilities.slice(0, 3),
            alternatives: data.nearby.alternatives.slice(0, 2),
            totalVouchers: data.nearby.voucher_facilities.length,
            totalAlternatives: data.nearby.alternatives.length,
          },
          {
            id: nextId('fit'),
            role: 'bot',
            kind: 'fitness_block',
            age: req.age,
            sex: req.sex,
            nearby: data.nearby,
          },
          {
            id: nextId('q'),
            role: 'bot',
            kind: 'chip_question',
            question: 'greet',
            text: '더 필요하신 게 있으면 아래에서 골라 주세요.',
            chips: followUp,
            select: 'action',
            inline: true,
          },
        )
      } catch (e) {
        push({ id: nextId('err'), role: 'bot', kind: 'error', error: toAppError(e) })
      } finally {
        dispatch({ type: 'setPending', pending: false })
      }
    },
    [dispatch, push, state.faq],
  )

  // 다음 미완 슬롯을 묻거나, 다 찼으면 판정으로 넘어간다(FR-12 AC6).
  const advance = useCallback(
    (slots: ChatSlots, list: Sigungu[] = sigungu) => {
      const q = nextQuestion(slots)
      if (q) {
        askQuestion(q, list)
        return
      }
      const req = toAssessRequest(slots, list)
      if (req) void runAssess(req)
    },
    [askQuestion, runAssess, sigungu],
  )

  // ── 부팅: 메타 로드 + 인사 ───────────────────────────────────
  useEffect(() => {
    if (booted.current) return
    booted.current = true

    // 목모드는 NLU 를 호출하지 않는다 — 처음부터 칩 모드(정직 라벨은 헤더/컴포저에 상시).
    if (useMockData()) dispatch({ type: 'setLlmMode', mode: 'chips' })

    push(botText(T.greet), botText(T.greetSub), botText(T.greetPrivacy, { tone: 'notice' }))

    // StrictMode 이중 마운트에서도 인사·메타 로드는 정확히 1회(booted 가드).
    // 언마운트 취소 플래그는 두지 않는다 — 첫 실행의 cleanup 이 두 번째 마운트의 결과를 버리기 때문.
    void (async () => {
      const [sg, ps] = await Promise.all([
        getSigungu().catch(() => [] as Sigungu[]),
        getPersonas().catch(() => [] as DemoPersona[]),
      ])
      setSigungu(sg)
      setPersonas(ps)
      dispatch({ type: 'setPhase', phase: 'collect' })
      // 퀵스타트(P1~P5)는 "인사 메시지의 칩"이다(FR-12 AC5) — 컴포저가 아니라 메시지 안에서 렌더.
      const spec = questionSpec('greet', { sigungu: sg, personas: ps })
      push({
        id: nextId('q'),
        role: 'bot',
        kind: 'chip_question',
        question: 'greet',
        text: ps.length > 0 ? '아래 상황 중 하나로 바로 체험해 보시거나, 직접 입력하실 수 있어요.' : spec.text,
        chips: spec.chips,
        select: 'action',
        inline: true,
      })
    })()

    // FAQ 사전(정적). 실패해도 대화는 그대로 동작한다.
    chatFaq()
      .then((f) => dispatch({ type: 'setFaq', faq: f }))
      .catch(() => undefined)
  }, [dispatch, push])

  // ── 강등(FR-12 AC4) ─────────────────────────────────────────
  const degrade = useCallback(() => {
    dispatch({ type: 'setLlmMode', mode: 'chips' })
    push(botText(T.degraded, { tone: 'notice' }), botText(T.degradedChips))
  }, [dispatch, push])

  // ── 액션 헬퍼 ───────────────────────────────────────────────
  const openPanel = useCallback(
    (tab: PanelTab) => {
      if (!state.lastAssess) {
        push(botText(T.mapNeedsResult))
        return
      }
      dispatch({ type: 'setPanel', open: true, tab })
      push(botText(T.mapOpened))
    },
    [dispatch, push, state.lastAssess],
  )

  const startFitness = useCallback(() => {
    if (!state.lastAssess) {
      push(botText(T.fitnessNeedsResult))
      return
    }
    dispatch({ type: 'openFitness' })
    push(botText(T.fitnessIntro))
  }, [dispatch, push, state.lastAssess])

  const answerFaq = useCallback(
    (key: string | null) => {
      const entry = key ? state.faq.find((f) => f.key === key) : undefined
      if (!entry) {
        push(botText(T.faqEmpty))
        return
      }
      push({ id: nextId('faq'), role: 'bot', kind: 'faq_answer', entry })
    },
    [push, state.faq],
  )

  const askRestart = useCallback(() => {
    const id = nextId('q')
    push({
      id,
      role: 'bot',
      kind: 'chip_question',
      question: 'greet',
      text: T.restartConfirm,
      chips: restartConfirmChips(),
      select: 'action',
      inline: true,
    })
  }, [push])

  const doRestart = useCallback(() => {
    dispatch({ type: 'reset', keep: { llmMode: state.llmMode, faq: state.faq } })
    lastAttempt.current = null
    push(botText(T.restarted), botText(T.greetSub))
    const spec = questionSpec('greet', { sigungu, personas })
    push({
      id: nextId('q'),
      role: 'bot',
      kind: 'chip_question',
      question: 'greet',
      text: '아래 상황 중 하나로 체험해 보시거나, 직접 입력하실 수 있어요.',
      chips: spec.chips,
      select: 'action',
      inline: true,
    })
    dispatch({ type: 'setPhase', phase: 'collect' })
  }, [dispatch, personas, push, sigungu, state.faq, state.llmMode])

  // ── 칩 클릭(외부 API 미전송) ────────────────────────────────
  const onChip = useCallback(
    (chip: Chip, msgId: string) => {
      const a = chip.action
      switch (a.kind) {
        case 'answer': {
          const patch = a.slots
          const next: ChatSlots = { ...state.slots, ...patch }
          if (patch.disability_has === false) next.disability_type = null
          push(userText(answerEcho(a.question, chip)))
          dispatch({ type: 'answerQuestion', id: msgId, label: chip.label })
          dispatch({ type: 'patchSlots', slots: patch })
          if (patch.income_unknown) {
            push(
              botText(T.incomeUnknownNotice),
              botText(T.incomeUnknownHow, {
                bullets: [...T.incomeUnknownBullets],
                links: [...T.incomeUnknownLinks],
              }),
            )
          }
          advance(next)
          return
        }
        case 'persona': {
          const p = personas.find((x) => x.id === a.personaId)
          if (!p) return
          push(userText(`${p.id} · ${p.label}`))
          dispatch({ type: 'answerQuestion', id: msgId, label: p.label })
          dispatch({ type: 'setSlots', slots: slotsFromRequest(p) })
          dispatch({ type: 'setPersona', id: p.id })
          push(botText(personaEchoText(p)))
          void runAssess(p)
          return
        }
        case 'manual_start': {
          push(userText(chip.label))
          dispatch({ type: 'answerQuestion', id: msgId, label: chip.label })
          advance(state.slots)
          return
        }
        case 'edit': {
          push(userText(`${chip.label} 고치기`))
          askQuestion(a.question)
          return
        }
        case 'faq': {
          push(userText(chip.label))
          answerFaq(a.faqKey)
          return
        }
        case 'open_panel': {
          push(userText(chip.label))
          openPanel(a.tab)
          return
        }
        case 'start_fitness': {
          push(userText(chip.label))
          startFitness()
          return
        }
        case 'restart': {
          push(userText(chip.label))
          if (a.step === 'ask') askRestart()
          else if (a.step === 'yes') doRestart()
          else push(botText(T.restartKeep))
          return
        }
      }
    },
    [
      advance,
      answerFaq,
      askQuestion,
      askRestart,
      dispatch,
      doRestart,
      openPanel,
      personas,
      push,
      runAssess,
      startFitness,
      state.slots,
    ],
  )

  // ── 자유 텍스트 ─────────────────────────────────────────────
  const onSend = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (text === '' || state.pending) return
      push(userText(text))

      if (state.llmMode === 'chips') {
        degrade()
        return
      }

      dispatch({ type: 'setPending', pending: true })
      try {
        const res = await chatNlu({
          text,
          slots: toWire(state.slots),
          phase: nluPhaseOf(state.phase),
        })
        // provider=rules 는 off/실패/쿼터 소진 — slot_updates 도 항상 비어 있다(API.md).
        if (res.provider !== 'openai') {
          degrade()
          return
        }

        // 클라 방어 검증: enum·범위 밖 값은 버린다(서버 pydantic 과 이중 방어).
        const u = res.slot_updates ?? {}
        const patch: Partial<ChatSlots> = {}
        const changed: QuestionId[] = []
        if (typeof u.age === 'number' && Number.isFinite(u.age) && u.age >= 0 && u.age <= 120) {
          patch.age = Math.round(u.age)
          changed.push('age')
        }
        if (u.sex === 'M' || u.sex === 'F') {
          patch.sex = u.sex as Sex
          changed.push('sex')
        }
        if (typeof u.sigungu_cd === 'string' && u.sigungu_cd !== '') {
          const hit = sigungu.find((s) => s.cd === u.sigungu_cd)
          patch.sigungu_cd = u.sigungu_cd
          patch.sigungu_nm = (typeof u.sigungu_nm === 'string' && u.sigungu_nm) || hit?.nm || ''
          changed.push('region')
        }
        if (typeof u.income_class === 'string' && INCOME_VALUES.includes(u.income_class as IncomeClass)) {
          patch.income_class = u.income_class as IncomeClass
          patch.income_unknown = false
          changed.push('income')
        }
        if (u.disability && typeof u.disability.has === 'boolean') {
          patch.disability_has = u.disability.has
          if (!u.disability.has) patch.disability_type = null
          changed.push('disability')
        }
        if (
          u.disability &&
          typeof u.disability.type === 'string' &&
          DISABILITY_TYPES.includes(u.disability.type as DisabilityType)
        ) {
          patch.disability_type = u.disability.type as DisabilityType
          if (patch.disability_has == null && state.slots.disability_has == null) patch.disability_has = true
          changed.push('disability_type')
        }

        const next: ChatSlots = { ...state.slots, ...patch }
        if (changed.length > 0) dispatch({ type: 'patchSlots', slots: patch })

        // 연결 멘트는 후필터 통과분만. null 이면 템플릿(다음 질문)이 이어진다.
        if (res.reply) push(botText(res.reply))

        // 갱신 슬롯 에코 = 정정 가능한 칩(탭하면 해당 질문 재개).
        if (changed.length > 0) {
          push({
            id: nextId('q'),
            role: 'bot',
            kind: 'chip_question',
            question: 'greet',
            text: SLOT_ECHO_PROMPT,
            chips: slotEditChips(changed, next),
            select: 'action',
            inline: true,
          })
        }

        // 지역 모호 → 후보 칩 재질문(코드 확정은 서버 결정론, FR-13 AC4).
        if (res.region_candidates.length > 0) {
          const id = nextId('q')
          push({
            id,
            role: 'bot',
            kind: 'chip_question',
            question: 'region',
            text: REGION_AMBIGUOUS_PROMPT,
            chips: regionCandidateChips(res.region_candidates),
            select: 'single',
            inline: true,
          })
          return
        }

        switch (res.intent) {
          case 'ask_faq':
            answerFaq(res.faq_key)
            return
          case 'start_fitness':
            startFitness()
            return
          case 'show_map':
            openPanel('map')
            return
          case 'restart':
            askRestart()
            return
          case 'provide_info':
          case 'unknown':
          default:
            if (changed.length === 0 && !res.reply) push(botText(T.unknownInLlm))
            if (state.phase === 'greet' || state.phase === 'collect') advance(next)
            return
        }
      } catch {
        degrade()
      } finally {
        dispatch({ type: 'setPending', pending: false })
      }
    },
    [
      advance,
      answerFaq,
      askRestart,
      degrade,
      dispatch,
      openPanel,
      push,
      sigungu,
      startFitness,
      state.llmMode,
      state.pending,
      state.phase,
      state.slots,
    ],
  )

  // ── 에러 재시도(입력 보존) ──────────────────────────────────
  const onRetry = useCallback(() => {
    const req = lastAttempt.current
    if (req) void runAssess(req)
  }, [runAssess])

  const setPanel = useCallback(
    (open: boolean, tab?: PanelTab) => dispatch({ type: 'setPanel', open, tab }),
    [dispatch],
  )
  const setFilterSports = useCallback(
    (sports?: string[]) => dispatch({ type: 'setFilterSports', sports }),
    [dispatch],
  )

  return {
    state,
    sigungu,
    personas,
    onChip,
    onSend,
    onRetry,
    setPanel,
    setFilterSports,
  }
}

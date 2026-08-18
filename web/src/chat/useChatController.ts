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
  FitnessTurnApi,
  NluPhase,
  NluSlotsWire,
  PanelTab,
  QuestionId,
} from '../types_chat'
import { EMPTY_SLOTS } from '../types_chat'
import { toAppError } from '../components/ErrorPanel'
import { nextId, useChat } from './store'
import { useFitness } from './useFitness'
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
  opts: {
    tone?: 'plain' | 'notice'
    sub?: string
    bullets?: string[]
    links?: { label: string; url: string }[]
  } = {},
): ChatMessage {
  return {
    id: nextId('b'),
    role: 'bot',
    kind: 'bot_text',
    text,
    sub: opts.sub,
    tone: opts.tone ?? 'plain',
    bullets: opts.bullets,
    links: opts.links,
  }
}

// 인사 = 버블 1개(자기소개 + 안내 + 보조 한 줄 고지). 쪼개지 않는다 —
// 랜딩에서 사용자가 읽어야 할 것은 "인사 1 + 첫 질문 1" 두 버블뿐이다(FR-12 AC5 v1.4).
function greetMessage(): ChatMessage {
  return botText(`${T.greet}\n${T.greetSub}`, { sub: T.greetPrivacy })
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

// demo = 해시 라우트 `/#/demo`(chat/route.ts). 대화 계약은 메인과 동일하고
// 인사 시퀀스(퀵스타트 칩)·경로 시각화 카드만 달라진다(FR-12 AC5 · FR-03 v1.4).
export function useChatController(demo = false) {
  const { state, dispatch } = useChat()
  const [sigungu, setSigungu] = useState<Sigungu[]>([])
  const [personas, setPersonas] = useState<DemoPersona[]>([])
  const lastAttempt = useRef<AssessRequest | null>(null)
  const booted = useRef(false)

  // 체력 레인(FR-07~09)의 조회·제출·AI 상태. 판정 결과의 나이·성별을 그대로 따른다.
  const lane = useFitness({
    age: state.lastAssess?.req.age ?? null,
    sex: state.lastAssess?.req.sex ?? null,
    active: state.fitness.active,
  })

  const push = useCallback(
    (...messages: ChatMessage[]) => dispatch({ type: 'push', messages }),
    [dispatch],
  )

  // ── 질문 던지기 ──────────────────────────────────────────────
  const askQuestion = useCallback(
    (
      q: QuestionId,
      list: Sigungu[] = sigungu,
      ps: DemoPersona[] = personas,
      // 세부 나이 칩(2단계)은 방금 고른 연령대에 따라 달라진다 — 스토어 반영을 기다리지 않도록
      // 호출부가 "지금 시점의 슬롯"을 함께 넘긴다.
      slots: ChatSlots = state.slots,
    ) => {
      const spec = questionSpec(q, { sigungu: list, personas: ps, slots })
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
    [dispatch, personas, push, sigungu, state.slots],
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
        // 경로 시각화(FR-03 v1.4): 데모 결과에만 항시 펼침으로 넣는다.
        // 메인 결과에는 아예 렌더하지 않는다 — 실사용 화면은 판정 카드 중심으로 경량화.
        const pathCard: ChatMessage[] = demo
          ? [{ id: nextId('p'), role: 'bot', kind: 'path', path: data.path }]
          : []
        push(
          botText(verdictText(req, data)),
          ...pathCard,
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
            id: nextId('q'),
            role: 'bot',
            kind: 'chip_question',
            question: 'greet',
            text: T.followUpPrompt,
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
    [demo, dispatch, push, state.faq],
  )

  // 다음 미완 슬롯을 묻거나, 다 찼으면 판정으로 넘어간다(FR-12 AC6).
  const advance = useCallback(
    (slots: ChatSlots, list: Sigungu[] = sigungu) => {
      const q = nextQuestion(slots)
      if (q) {
        askQuestion(q, list, personas, slots)
        return
      }
      const req = toAssessRequest(slots, list)
      if (req) void runAssess(req)
    },
    [askQuestion, personas, runAssess, sigungu],
  )

  // ── 부팅: 메타 로드 + 인사 ───────────────────────────────────
  useEffect(() => {
    if (booted.current) return
    booted.current = true

    // 목모드는 NLU 를 호출하지 않는다 — 처음부터 칩 모드(정직 라벨은 헤더/컴포저에 상시).
    if (useMockData()) dispatch({ type: 'setLlmMode', mode: 'chips' })

    push(greetMessage())

    // 메인(실사용 랜딩, FR-12 AC5 v1.4): 데모 안내 문구·퀵스타트 칩 없이 곧바로 첫 질문.
    // 나이 질문은 시군구·페르소나 메타를 기다리지 않으므로 인사 직후 바로 던진다.
    if (!demo) {
      dispatch({ type: 'setPhase', phase: 'collect' })
      // 1단계는 연령대 칩(FR-12 AC6 v1.5) — 시군구·페르소나 메타와 무관하다.
      askQuestion('age_band', [], [], EMPTY_SLOTS)
    }

    // StrictMode 이중 마운트에서도 인사·메타 로드는 정확히 1회(booted 가드).
    // 언마운트 취소 플래그는 두지 않는다 — 첫 실행의 cleanup 이 두 번째 마운트의 결과를 버리기 때문.
    void (async () => {
      const [sg, ps] = await Promise.all([
        getSigungu().catch(() => [] as Sigungu[]),
        // 페르소나는 데모 페이지 전용 데이터 — 메인에서는 조회하지 않는다.
        demo ? getPersonas().catch(() => [] as DemoPersona[]) : Promise.resolve([] as DemoPersona[]),
      ])
      setSigungu(sg)
      setPersonas(ps)
      if (!demo) return
      dispatch({ type: 'setPhase', phase: 'collect' })
      // 퀵스타트(P1~P5)는 "인사 메시지의 칩"이다(FR-12 AC5) — 컴포저가 아니라 메시지 안에서 렌더.
      const spec = questionSpec('greet', { sigungu: sg, personas: ps })
      push({
        id: nextId('q'),
        role: 'bot',
        kind: 'chip_question',
        question: 'greet',
        text: ps.length > 0 ? `${T.demoIntro}\n${T.demoQuickStart}` : spec.text,
        chips: spec.chips,
        select: 'action',
        inline: true,
      })
    })()

    // FAQ 사전(정적). 실패해도 대화는 그대로 동작한다.
    chatFaq()
      .then((f) => dispatch({ type: 'setFaq', faq: f }))
      .catch(() => undefined)
  }, [askQuestion, demo, dispatch, push])

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

  // ── 체력 레인 3턴(PAR-Q → 측정 폼 → 결과) ──────────────────────
  // 나비는 안내만 한다. 문진 내용·측정 항목·판정·처방은 전부 카드가 말한다(FR-12 AC2).
  const startFitness = useCallback(() => {
    if (!state.lastAssess) {
      push(botText(T.fitnessNeedsResult))
      return
    }
    if (state.fitness.active) {
      push(botText(T.fitnessAlready))
      return
    }
    dispatch({ type: 'fitnessStart' })
    dispatch({ type: 'setPhase', phase: 'fitness' })
    push(botText(T.fitnessIntro), {
      id: nextId('fitq'),
      role: 'bot',
      kind: 'fitness_parq',
      laneId: state.fitness.laneId + 1,
    })
  }, [dispatch, push, state.fitness.active, state.fitness.laneId, state.lastAssess])

  // 턴1 통과 → 턴2(측정 폼). 게이트를 통과해야만 폼이 나온다(FR-07 AC5).
  const onParqContinue = useCallback(() => {
    if (state.fitness.parqOk) return
    dispatch({ type: 'fitnessParqOk' })
    push(botText(T.fitnessFormIntro), {
      id: nextId('fitf'),
      role: 'bot',
      kind: 'fitness_form',
      laneId: state.fitness.laneId,
    })
  }, [dispatch, push, state.fitness.laneId, state.fitness.parqOk])

  // 턴2 제출 → 턴3(결과 카드). 실패는 폼 카드 안 인라인 패널이 말한다(재시도 버튼 포함).
  const onFitnessSubmit = useCallback(
    (measures: Record<string, number>) => {
      const assessed = state.lastAssess
      if (!assessed) return
      void (async () => {
        const res = await lane.submit(measures)
        if (!res) return
        const id = nextId('fitr')
        const first = state.fitness.resultMsgId == null
        dispatch({ type: 'fitnessResult', msgId: id })
        push(botText(T.fitnessResultIntro), {
          id,
          role: 'bot',
          kind: 'fitness_result',
          laneId: state.fitness.laneId,
          result: res,
          nearby: assessed.data.nearby,
        })
        // 레인을 마치면 질의응답 단계로 복귀 + 후속 칩(지도·목록·FAQ·처음부터).
        dispatch({ type: 'setPhase', phase: 'qa' })
        if (first) {
          push({
            id: nextId('q'),
            role: 'bot',
            kind: 'chip_question',
            question: 'greet',
            text: T.followUpPrompt,
            chips: followUpChips(
              state.faq.map((f) => ({ key: f.key, q: f.q })),
              { fitness: false, suffix: 'fit' },
            ),
            select: 'action',
            inline: true,
          })
        }
      })()
    },
    [dispatch, lane, push, state.faq, state.fitness.laneId, state.fitness.resultMsgId, state.lastAssess],
  )

  // 처방 → 강좌 연결(FR-09 AC1): 종목 필터 + 목록 탭 전환 + 한 줄 안내.
  const applyFilter = useCallback(
    (sports: string[]) => {
      dispatch({ type: 'setFilterSports', sports })
      dispatch({ type: 'setPanel', open: true, tab: 'list' })
      push(botText(T.fitnessFilterApplied))
    },
    [dispatch, push],
  )

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
    push(botText(T.restarted, { sub: T.greetPrivacy }))
    dispatch({ type: 'setPhase', phase: 'collect' })
    // 메인은 다시 첫 질문(연령대)부터, 데모는 다시 퀵스타트 칩부터.
    if (!demo) {
      askQuestion('age_band', sigungu, personas, EMPTY_SLOTS)
      return
    }
    const spec = questionSpec('greet', { sigungu, personas })
    push({
      id: nextId('q'),
      role: 'bot',
      kind: 'chip_question',
      question: 'greet',
      text: T.demoQuickStart,
      chips: spec.chips,
      select: 'action',
      inline: true,
    })
  }, [askQuestion, demo, dispatch, personas, push, sigungu, state.faq, state.llmMode])

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
          // 나이 정정은 2단계 흐름으로 다시 들어간다(FR-12 AC6 v1.5).
          // 옛 나이를 비우지 않으면 연령대만 고른 순간 슬롯이 다 찬 것으로 보여
          // 옛 나이로 판정이 튀어나간다 — 정확 나이 재확인이 이 흐름의 요점이다.
          if (a.question === 'age' || a.question === 'age_band') {
            const cleared: ChatSlots = { ...state.slots, age: null, age_band: null }
            dispatch({ type: 'patchSlots', slots: { age: null, age_band: null } })
            askQuestion('age_band', sigungu, personas, cleared)
            return
          }
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
      sigungu,
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

  // 메시지 렌더러가 받는 체력 턴 계약 = 레인 훅 + 스토어 진행도 + 턴 진행 액션.
  const fitness: FitnessTurnApi = {
    ...lane,
    laneId: state.fitness.laneId,
    parqOk: state.fitness.parqOk,
    resultMsgId: state.fitness.resultMsgId,
    onParqContinue,
    onSubmit: onFitnessSubmit,
  }

  return {
    state,
    sigungu,
    personas,
    onChip,
    onSend,
    onRetry,
    setPanel,
    setFilterSports,
    applyFilter,
    fitness,
  }
}

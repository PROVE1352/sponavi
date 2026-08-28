// 대화 오케스트레이션. 정책(policy.ts)이 "무엇을 말할지"를, 여기서 "언제 어떻게"를 담당한다.
//
//   칩 입력  → 슬롯 직접 갱신 · LLM 0회 · 챗 엔드포인트 무호출(ARCHITECTURE §11.1)
//   자유 텍스트 → POST /api/chat/nlu (목모드·실패·provider=rules 면 칩 모드로 강등)
//   슬롯 완성 → POST /api/assess → 카드 메시지들
//
// 저장 금지(P-3): 슬롯·대화는 메모리에만 둔다. localStorage/sessionStorage 미사용.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  FitnessResultMsg,
  FitnessTurnApi,
  NluPhase,
  NluSlotsWire,
  PanelTab,
  QuestionId,
} from '../types_chat'
import { EMPTY_SLOTS } from '../types_chat'
import { toAppError } from '../components/ErrorPanel'
import { pickAutoplayPersona, prefillMeasures, type AutoplayCommand } from './autoplay'
import { useAutoplay } from './useAutoplay'
import { readDemoRoute } from './route'
import { nextId, useChat } from './store'
import { useFitness } from './useFitness'
import {
  DISABILITY_TYPES,
  INCOME_OPTIONS,
  REGION_AMBIGUOUS_PROMPT,
  SLOT_ECHO_PROMPT,
  T,
  answerEcho,
  followUpChips,
  matchSido,
  matchSigungu,
  nextQuestion,
  personaEchoText,
  questionSpec,
  regionCandidateChips,
  regionChips,
  restartConfirmChips,
  sidoCdOf,
  sidoLabel,
  sigunguOfSido,
  slotEditChips,
  slotsFromRequest,
  toAssessRequest,
  verdictText,
} from './policy'

const INCOME_VALUES = INCOME_OPTIONS.map((o) => o.value)

// 자동재생이 대신 눌러 주는 "체력 처방 시작". 히어로 CTA·후속 칩과 **같은 액션**이다 —
// 자동재생 전용 진입로를 새로 만들지 않는다(FR-02 AC5 · 설계 W2 행).
const AUTOPLAY_FITNESS_CHIP: Chip = {
  id: 'act-fitness-auto',
  label: '체력 처방 시작',
  action: { kind: 'start_fitness' },
}

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
  // W2 자동재생: 딥링크가 자동재생을 요청했고 페르소나까지 확정됐는가.
  const [autoArmed, setAutoArmed] = useState(false)
  // `/api/demo/personas` 실패 시의 P2 폴백 바디(목록에 없으므로 따로 들고 있는다).
  const [autoFallback, setAutoFallback] = useState<DemoPersona | null>(null)
  // 자동재생이 PAR-Q 를 프리셋으로 통과시켰는가(카드 위 라벨의 근거).
  const [autoParqUsed, setAutoParqUsed] = useState(false)

  // 3A: 데모 페르소나를 골랐다면 그 페르소나의 측정값이 체력 폼의 씨앗이 된다
  // (심사위원이 혼자 밟는 경로 — 값을 손으로 넣지 않아도 처방까지 간다).
  const activePersona =
    personas.find((p) => p.id === state.activePersonaId) ??
    (autoFallback && autoFallback.id === state.activePersonaId ? autoFallback : null)

  // 체력 레인(FR-07~09)의 조회·제출·AI 상태. 판정 결과의 나이·성별을 그대로 따른다.
  const lane = useFitness({
    age: state.lastAssess?.req.age ?? null,
    sex: state.lastAssess?.req.sex ?? null,
    active: state.fitness.active,
    prefill: activePersona?.demo?.fitness ?? null,
  })

  const push = useCallback(
    (...messages: ChatMessage[]) => dispatch({ type: 'push', messages }),
    [dispatch],
  )

  // 후속 칩에 붙일 FAQ 사전의 "지금 값". 판정은 부팅 직후에도 일어날 수 있는데(딥링크 p=),
  // 그때 클로저가 잡은 빈 배열을 쓰면 딥링크 결과에만 FAQ 칩이 빠진다 — 칩 경로와 어긋난다.
  const faqRef = useRef(state.faq)
  useEffect(() => {
    faqRef.current = state.faq
  }, [state.faq])

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
        const followUp = followUpChips(faqRef.current.map((f) => ({ key: f.key, q: f.q })))
        // 경로 시각화(FR-03 v1.4): 데모 결과에만 항시 펼침으로 넣는다.
        // 메인 결과에는 아예 렌더하지 않는다 — 실사용 화면은 판정 카드 중심으로 경량화.
        const pathCard: ChatMessage[] = demo
          ? [{ id: nextId('p'), role: 'bot', kind: 'path', path: data.path }]
          : []
        // ★ v1.7: 판정 카드·공급공백·시설 요약을 메시지 하나로 합친다(FR-12 AC9).
        //   결과가 버블 여러 개로 세로로 쌓이면 모바일에서 화면이 위아래로 크게 흔들린다.
        //   합친 뒤의 렌더 형태(모바일 덱 / 데스크톱 블록)는 메시지 렌더러가 정한다.
        push(
          botText(verdictText(req, data)),
          ...pathCard,
          { id: nextId('e'), role: 'bot', kind: 'assess_result', req, data },
          {
            id: nextId('q'),
            role: 'bot',
            kind: 'chip_question',
            question: 'greet',
            text: T.followUpPrompt,
            chips: followUp,
            select: 'action',
          },
        )
      } catch (e) {
        push({ id: nextId('err'), role: 'bot', kind: 'error', error: toAppError(e) })
      } finally {
        dispatch({ type: 'setPending', pending: false })
      }
    },
    [demo, dispatch, push],
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

  // 퀵스타트 페르소나 확정 1벌 — 칩 클릭과 딥링크(`#/demo?p=P2`)가 같은 경로를 탄다(OV10).
  // LLM 0회: 슬롯을 직접 채우고 곧바로 판정한다.
  const selectPersona = useCallback(
    (p: DemoPersona, msgId: string) => {
      push(userText(`${p.id} · ${p.label}`))
      dispatch({ type: 'answerQuestion', id: msgId, label: p.label })
      dispatch({ type: 'setSlots', slots: slotsFromRequest(p) })
      dispatch({ type: 'setPersona', id: p.id })
      push(botText(personaEchoText(p)))
      void runAssess(p)
    },
    [dispatch, push, runAssess],
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
      const greetId = nextId('q')
      push({
        id: greetId,
        role: 'bot',
        kind: 'chip_question',
        question: 'greet',
        text: ps.length > 0 ? `${T.demoIntro}\n${T.demoQuickStart}` : spec.text,
        chips: spec.chips,
        select: 'action',
      })

      // OV10 딥링크: `#/demo?p=P2` 는 그 칩을 대신 눌러 준다(LLM 0회 · 칩 경로 그대로).
      // W2: `auto=1` 이면 그다음 여정(체력 처방 → 필터)을 자동재생이 이어 받는다.
      //   · 페르소나 조회가 죽어도 `p=P2&auto=1` 은 클라 상수 바디로 재생된다(실패 모드 표)
      //   · `auto` 만 있고 `p` 가 없으면 아무 일도 하지 않는다
      const { p: wanted, auto } = readDemoRoute()
      const { persona: picked, fallback } = pickAutoplayPersona(ps, wanted, auto)
      if (!picked) return
      if (fallback) setAutoFallback(picked)
      selectPersona(picked, greetId)
      if (auto) setAutoArmed(true)
    })()

    // FAQ 사전(정적). 실패해도 대화는 그대로 동작한다.
    chatFaq()
      .then((f) => dispatch({ type: 'setFaq', faq: f }))
      .catch(() => undefined)
  }, [askQuestion, demo, dispatch, push, selectPersona])

  // ── 강등(FR-12 AC4) ─────────────────────────────────────────
  const degrade = useCallback(() => {
    dispatch({ type: 'setLlmMode', mode: 'chips' })
    push(botText(T.degraded, { tone: 'notice' }), botText(T.degradedChips))
  }, [dispatch, push])

  // ── 액션 헬퍼 ───────────────────────────────────────────────
  // 지도·목록 열기. 모바일에서 패널은 스트림 위쪽에 있고 결과 도착과 함께 이미 펼쳐져 있어,
  // 상태만 바꾸면 "눌러도 아무 일도 없는" 버튼이 된다 — focus 로 셸이 패널까지 스크롤한다.
  const openPanel = useCallback(
    (tab: PanelTab) => {
      if (!state.lastAssess) {
        push(botText(T.mapNeedsResult))
        return
      }
      dispatch({ type: 'setPanel', open: true, tab, focus: true })
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
      dispatch({ type: 'setPanel', open: true, tab: 'list', focus: true })
      push(botText(T.fitnessFilterApplied))
    },
    [dispatch, push],
  )

  // 카드 전체 렌더(칩 FAQ · answer 없는 라우팅). 접지 답변이 있는 턴은 컴팩트 출처 카드를
  // 직접 붙이므로 이 경로를 타지 않는다(FR-13 AC9).
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
    })
  }, [askQuestion, demo, dispatch, personas, push, sigungu, state.faq, state.llmMode])

  // ── 칩 클릭(외부 API 미전송) ────────────────────────────────
  const onChip = useCallback(
    (chip: Chip, msgId: string) => {
      const a = chip.action
      switch (a.kind) {
        case 'answer': {
          const patch = { ...a.slots }
          let echo = answerEcho(a.question, chip)
          let lockLabel = chip.label
          // 시도에 시군구가 하나뿐이면(세종 등) 2단계를 묻지 않고 그 자리에서 확정한다.
          // 잠금 마커·에코는 고른 시도가 아니라 확정된 시군구 이름으로 남긴다.
          if (a.question === 'region_sido' && patch.sido_cd) {
            const only = sigunguOfSido(sigungu, patch.sido_cd)
            if (only.length === 1) {
              patch.sigungu_cd = only[0].cd
              patch.sigungu_nm = only[0].nm
              echo = `지역: ${only[0].nm}`
              lockLabel = only[0].nm
            }
          }
          const next: ChatSlots = { ...state.slots, ...patch }
          if (patch.disability_has === false) next.disability_type = null
          push(userText(echo))
          dispatch({ type: 'answerQuestion', id: msgId, label: lockLabel })
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
          selectPersona(p, msgId)
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
          // 지역 정정도 2단계(시도 → 시군구) 전체를 다시 연다(FR-12 AC1 v1.7).
          if (a.question === 'region' || a.question === 'region_sido') {
            const blank = { sido_cd: null, sigungu_cd: null, sigungu_nm: null }
            dispatch({ type: 'patchSlots', slots: blank })
            askQuestion('region_sido', sigungu, personas, { ...state.slots, ...blank })
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
      selectPersona,
      sigungu,
      startFitness,
      state.slots,
    ],
  )

  // ── 지역 자유입력의 로컬 결정론 매칭(FR-12 AC1 v1.7) ────────────────
  // 칩/강등 모드에는 NLU 가 없다. 그래도 컴포저에 "성북구"라고 쓰면 칩과 똑같이 확정되어야 한다.
  // 판단 재료는 getSigungu() 목록뿐이고 추측은 없다 — 1건 확정 / 복수 후보 칩 / 0건 재질문.
  const resolveRegionText = useCallback(
    (text: string, questionId: string, stage: 'region_sido' | 'region') => {
      const confirm = (s: Sigungu) => {
        const patch: Partial<ChatSlots> = {
          sido_cd: sidoCdOf(s.cd),
          sigungu_cd: s.cd,
          sigungu_nm: s.nm,
        }
        dispatch({ type: 'answerQuestion', id: questionId, label: s.nm })
        dispatch({ type: 'patchSlots', slots: patch })
        advance({ ...state.slots, ...patch })
      }

      // ① 입력이 시도 이름 하나면 그 시도로 좁힌다(그 안이 1곳뿐이면 즉시 확정).
      const sido = matchSido(text)
      if (sido) {
        const inSido = sigunguOfSido(sigungu, sido)
        if (inSido.length === 1) {
          confirm(inSido[0])
          return
        }
        if (inSido.length > 1) {
          const patch: Partial<ChatSlots> = { sido_cd: sido }
          dispatch({ type: 'answerQuestion', id: questionId, label: sidoLabel(sido) })
          dispatch({ type: 'patchSlots', slots: patch })
          askQuestion('region', sigungu, personas, { ...state.slots, ...patch })
          return
        }
      }

      // ② 시군구 이름 매칭
      const hits = matchSigungu(sigungu, text)
      if (hits.length === 1) {
        confirm(hits[0])
        return
      }
      if (hits.length > 1) {
        const id = nextId('q')
        push({
          id,
          role: 'bot',
          kind: 'chip_question',
          question: 'region',
          text: REGION_AMBIGUOUS_PROMPT,
          // 동명 시군구(서구 등)는 시도 통칭을 붙여야 구분된다.
          chips: regionChips(hits, { withSido: true }),
          select: 'single',
        })
        dispatch({ type: 'setActiveQuestion', id })
        return
      }

      push(botText(T.regionNotFound))
      askQuestion(stage, sigungu, personas, state.slots)
    },
    [advance, askQuestion, dispatch, personas, push, sigungu, state.slots],
  )

  // ── 자유 텍스트 ─────────────────────────────────────────────
  const onSend = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (text === '' || state.pending) return
      push(userText(text))

      if (state.llmMode === 'chips') {
        // 지역 질문이 열려 있으면 강등 안내 대신 로컬 매칭으로 답한다(칩과 동일 동작).
        const open = state.messages.find((m) => m.id === state.activeQuestionId)
        if (
          open &&
          open.kind === 'chip_question' &&
          (open.question === 'region' || open.question === 'region_sido')
        ) {
          resolveRegionText(text, open.id, open.question)
          return
        }
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
          patch.sido_cd = sidoCdOf(u.sigungu_cd)
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

        // ── 접지 답변 레인(v1.9 · FR-13 AC9) ─────────────────────────────
        // answer 는 fact-lock 을 통과한 것만 온다. 있으면 그것이 이 턴의 본문이고,
        // 출처는 같은 faq_key 의 카드를 컴팩트 형태로 바로 아래 붙여 동반한다.
        // 카드를 찾지 못하면(사전 로드 실패 등) 답변만 남기고 보조 줄 문구를 바꾼다.
        const answer = typeof res.answer === 'string' && res.answer.trim() !== '' ? res.answer.trim() : null
        const answerEntry = res.faq_key ? state.faq.find((f) => f.key === res.faq_key) : undefined

        if (answer) {
          // reply 와 둘 다 오면 answer 만 쓴다 — 버블 두 개가 잇달아 나오면 수다스럽다.
          push(botText(answer, { sub: answerEntry ? T.answerSubWithCard : T.answerSubNoCard }))
          if (answerEntry) {
            push({ id: nextId('faq'), role: 'bot', kind: 'faq_answer', entry: answerEntry, compact: true })
          }
        } else if (res.reply) {
          // 연결 멘트는 후필터 통과분만. null 이면 템플릿(다음 질문)이 이어진다.
          push(botText(res.reply))
        }

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
          })
          // 이 재질문이 지금 열려 있는 질문이 된다 — 그래야 후보 칩이 살아 있다(FR-12 AC1 v1.6).
          dispatch({ type: 'setActiveQuestion', id })
          return
        }

        switch (res.intent) {
          case 'ask_faq':
            // answer 를 이미 냈으면 카드는 위에서 컴팩트로 붙었다 — 전체 카드를 겹쳐 내지 않는다.
            if (!answer) answerFaq(res.faq_key)
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
            if (changed.length === 0 && !res.reply && !answer) push(botText(T.unknownInLlm))
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
      resolveRegionText,
      sigungu,
      startFitness,
      state.activeQuestionId,
      state.faq,
      state.llmMode,
      state.messages,
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

  // ── W2 자동재생 ─────────────────────────────────────────────
  // 단계 판단은 autoplay.ts(순수 상태기계), 시간·취소·스크롤은 useAutoplay 가 갖는다.
  // 여기서는 "화면이 어디까지 왔는가"를 모아 넘기고, 명령을 기존 액션에 그대로 태운다.
  const autoMeasures = useMemo(
    () => prefillMeasures(lane.grouped, activePersona?.demo?.fitness ?? null),
    [activePersona, lane.grouped],
  )

  const autoResult = state.messages.find(
    (m): m is FitnessResultMsg =>
      m.kind === 'fitness_result' && m.id === state.fitness.resultMsgId,
  )

  const onAutoCommand = useCallback(
    (command: AutoplayCommand) => {
      switch (command.kind) {
        case 'start_fitness':
          onChip(AUTOPLAY_FITNESS_CHIP, '')
          return
        case 'pass_parq':
          setAutoParqUsed(true)
          onParqContinue()
          return
        case 'submit_form':
          onFitnessSubmit(command.measures)
          return
        case 'apply_filter':
          applyFilter(command.sports)
          return
      }
    },
    [applyFilter, onChip, onFitnessSubmit, onParqContinue],
  )

  const autoplay = useAutoplay({
    armed: autoArmed,
    progress: state.reveal.revealed,
    view: {
      settled: state.reveal.settled,
      busy: state.pending || lane.itemsLoading || lane.submitting,
      assessDone: state.messages.some((m) => m.kind === 'assess_result'),
      // /api/assess 실패 = error 버블 + 재시도 버튼 → 자동재생은 중단(클라 룰 폴백 없음).
      assessError: state.messages.some((m) => m.kind === 'error'),
      parqPreset: activePersona?.demo?.parq_preset === true,
      parqShown: state.messages.some((m) => m.kind === 'fitness_parq'),
      formShown: state.messages.some((m) => m.kind === 'fitness_form'),
      itemsError: lane.itemsError,
      itemsReady: lane.grouped.length > 0,
      measures: autoMeasures,
      submitError: lane.submitError != null,
      resultShown: autoResult != null,
      filterSports: autoResult?.result.facility_filter_sports ?? [],
    },
    onCommand: onAutoCommand,
  })

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
    // 3A: 체력 폼이 마운트될 때 쓸 데모 프리필(선택된 페르소나의 측정값).
    fitnessPrefill: lane.initialValues,
    // W2: 자동재생 진행 여부(상태 필) + PAR-Q 프리셋 표기.
    autoplayRunning: autoplay.running,
    parqPreset: autoParqUsed,
    onChip,
    onSend,
    onRetry,
    // 스트림 카드의 "지도에서 보기" 버튼도 칩과 같은 경로를 타야 한다 —
    // 패널 열기 + 한 줄 안내 + 패널로 데려가기(focus)가 한 벌이다.
    openPanel,
    setPanel,
    setFilterSports,
    applyFilter,
    fitness,
  }
}

// 체력 레인(FR-07~09)의 부수효과·상태 소유자.
// 뷰 3분할(ParqGate · FitnessFormCard · FitnessResultCard)이 순수 렌더만 하도록
// fetch/abort/재시도 상태를 여기 모은다(ARCHITECTURE §11.4 "FitnessStep은 useFitness() 훅 + 3분할").
//
//   · 연령군 동적 카탈로그 조회 GET /api/fitness/items (itemsToken 레이스 가드)
//   · 측정값 제출      POST /api/fitness
//   · AI 처방          POST /api/fitness/ai (AbortController · 95s · 사용자 취소 가능)
//
// ★ PAR-Q 문진 응답은 이 훅에 들어오지 않는다 — 게이트 컴포넌트의 로컬 상태이며
//   저장·전송되지 않는다(FR-07 AC5 / P-3 비저장).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fitness, fitnessAi, getFitnessItems } from '../api/client'
import type {
  FitnessAiResponse,
  FitnessItem,
  FitnessItemsResponse,
  FitnessResponse,
  Sex,
} from '../types'
import type { FitnessFormRow, FitnessLaneApi } from '../types_chat'
import { toAppError, type AppError } from '../components/ErrorPanel'

// 서버가 message 를 주지 않을 때의 고지 문구(FR-07 AC6 · 공백을 숨기지 않는다).
const GAP_FALLBACK =
  '이 연령은 국민체력100 공식 기준이 없습니다 — 유소년(11~12세) 기준을 참고로 제공합니다.'
const EMPTY_FALLBACK = '이 연령군은 등급 판정 측정항목이 없습니다.'

// 대체항목(alt_group) 2개 이상은 한 슬롯(택1)으로 접는다 — 공식 기준표의 A/B 구조.
export function buildRows(items: FitnessItem[]): FitnessFormRow[] {
  const altMap = new Map<string, FitnessItem[]>()
  for (const it of items) {
    if (it.alt_group) {
      const arr = altMap.get(it.alt_group) ?? []
      arr.push(it)
      altMap.set(it.alt_group, arr)
    }
  }
  const rows: FitnessFormRow[] = []
  const consumed = new Set<string>()
  for (const it of items) {
    if (it.alt_group) {
      const group = altMap.get(it.alt_group)!
      if (group.length >= 2) {
        if (!consumed.has(it.alt_group)) {
          consumed.add(it.alt_group)
          rows.push({ kind: 'alt', altGroup: it.alt_group, factor: it.factor, options: group })
        }
        continue
      }
    }
    rows.push({ kind: 'single', item: it })
  }
  return rows
}

export interface UseFitnessResult extends FitnessLaneApi {
  // 제출 성공 시 판정 결과(실패는 submitError 로 표면화하고 null 반환).
  submit: (measures: Record<string, number>) => Promise<FitnessResponse | null>
  // 3A: 폼이 마운트될 때 씨앗으로 쓸 데모 프리필(코드→값). 레인이 꺼져 있으면 null.
  initialValues: Record<string, number> | null
}

export function useFitness({
  age,
  sex,
  active,
  prefill = null,
}: {
  age: number | null
  sex: Sex | null
  // 레인이 시작되기 전(=PAR-Q 턴 이전)에는 카탈로그도 부르지 않는다.
  active: boolean
  // 데모 페르소나가 들고 온 측정값(GET /api/demo/personas 의 demo.fitness). 없으면 null.
  prefill?: Record<string, number> | null
}): UseFitnessResult {
  const [items, setItems] = useState<FitnessItemsResponse | null>(null)
  const [itemsError, setItemsError] = useState(false)
  const [itemsLoading, setItemsLoading] = useState(false)
  const itemsToken = useRef(0)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<AppError | null>(null)

  const [ai, setAi] = useState<FitnessAiResponse | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<AppError | null>(null)
  const aiAbort = useRef<AbortController | null>(null)
  const aiCanceled = useRef(false)

  // AI 처방이 인용할 측정값 = 마지막으로 제출한 값(결과 카드와 어긋나지 않게 고정).
  const measures = useRef<Record<string, number>>({})

  // 측정항목 카탈로그 조회. 실패 시 폼 대신 재시도 패널을 띄운다(itemsError).
  const loadItems = useCallback((a: number) => {
    const token = ++itemsToken.current
    setItemsLoading(true)
    setItemsError(false)
    getFitnessItems(a)
      .then((r) => {
        if (token !== itemsToken.current) return
        setItems(r)
        setItemsError(false)
      })
      .catch(() => {
        if (token !== itemsToken.current) return
        setItems(null)
        setItemsError(true)
      })
      .finally(() => {
        if (token === itemsToken.current) setItemsLoading(false)
      })
  }, [])

  const reloadItems = useCallback(() => {
    if (age != null) loadItems(age)
  }, [age, loadItems])

  // 레인 시작 / 나이 변경(다른 상황 선택) → 이전 결과·AI·에러를 버리고 카탈로그를 다시 받는다.
  useEffect(() => {
    itemsToken.current += 1 // 진행 중 응답 폐기
    aiCanceled.current = true
    aiAbort.current?.abort()
    aiAbort.current = null
    measures.current = {}
    setItems(null)
    setItemsError(false)
    setItemsLoading(false)
    setSubmitError(null)
    setAi(null)
    setAiError(null)
    setAiLoading(false)
    if (!active || age == null) return
    loadItems(age)
  }, [active, age, loadItems])

  // 언마운트 시 진행 중인 AI 요청 정리.
  useEffect(() => {
    return () => {
      aiCanceled.current = true
      aiAbort.current?.abort()
      aiAbort.current = null
    }
  }, [])

  // 항목을 factor 로 그룹핑(표시 순서 = 카탈로그 순서).
  const grouped = useMemo<[string, FitnessFormRow[]][]>(() => {
    const rows = items ? buildRows(items.items) : []
    const map = new Map<string, FitnessFormRow[]>()
    for (const row of rows) {
      const f = row.kind === 'single' ? row.item.factor : row.factor
      const arr = map.get(f) ?? []
      arr.push(row)
      map.set(f, arr)
    }
    return Array.from(map.entries())
  }, [items])

  const gapMessage = items?.age_gap ? (items.message ?? GAP_FALLBACK) : null
  const emptyMessage =
    items && items.items.length === 0 ? (items.message ?? EMPTY_FALLBACK) : null

  const submit = useCallback(
    async (m: Record<string, number>): Promise<FitnessResponse | null> => {
      if (age == null || sex == null) return null
      measures.current = m
      setSubmitting(true)
      setAi(null)
      setAiError(null)
      setSubmitError(null)
      try {
        return await fitness({ age, sex, measures: m })
      } catch (e) {
        setSubmitError(toAppError(e)) // POST 는 자동 재시도 없음 → 수동 재시도 버튼 제공
        return null
      } finally {
        setSubmitting(false)
      }
    },
    [age, sex],
  )

  const requestAi = useCallback(() => {
    if (age == null || sex == null) return
    aiCanceled.current = false
    const ctrl = new AbortController()
    aiAbort.current = ctrl
    setAiError(null)
    setAiLoading(true)
    void (async () => {
      try {
        const res = await fitnessAi({ age, sex, measures: measures.current }, ctrl.signal)
        if (aiCanceled.current) return
        setAi(res)
      } catch (e) {
        if (aiCanceled.current) return
        const err = toAppError(e)
        if (err.kind !== 'canceled') setAiError(err) // 429 는 err.message 를 그대로 노출
      } finally {
        if (aiAbort.current === ctrl) aiAbort.current = null
        if (!aiCanceled.current) setAiLoading(false)
      }
    })()
  }, [age, sex])

  // 사용자가 "처방 생성"을 취소 — 실서버는 요청을 중단하고, 목/느린 응답은 결과를 버린다.
  const cancelAi = useCallback(() => {
    aiCanceled.current = true
    aiAbort.current?.abort()
    aiAbort.current = null
    setAiLoading(false)
  }, [])

  return {
    itemsLoading,
    itemsError,
    reloadItems,
    gapMessage,
    emptyMessage,
    grouped,
    submitting,
    submitError,
    ai,
    aiLoading,
    aiError,
    requestAi,
    cancelAi,
    submit,
    initialValues: active ? prefill : null,
  }
}

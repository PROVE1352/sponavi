// "이 지역에서 다시 찾기" — 상태 기계(useAreaSearch)와 결과 막대(AreaSearchBar).
//
// 컨텍스트 패널이 소유한다(지도·목록 두 탭이 같은 상태를 본다). 규약(계약서 §6.6·§6.8):
//   · 주 이용권(svoucher|dvoucher)과 public 두 요청을 **동시에** 보낸다. 둘 다 실패하면 error,
//     하나만 실패하면 done 이고 그쪽 Side 가 failed 다(부분 실패 격리).
//   · 새 요청은 이전 요청을 abort 하고, 늦게 온 응답은 generation 검사로 버린다.
//   · loading·error 동안 화면은 직전 결과(displayed)를 그대로 둔다.
//   · 막대는 시각 전용(role 없음) — 낭독은 패널의 상태 노드가 한다.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent, RefObject } from 'react'
import { ApiCallError, searchFacilitiesInBounds } from '../api/client'
import type {
  AreaBounds,
  AreaMapPoint,
  FacilityAreaResponse,
  FacilitySearchProgram,
  UnlocatedArea,
} from '../types_search'
import {
  AREA_LIMIT,
  AREA_TEXT,
  areaErrorRetryable,
  barCounts,
  barTitle,
  dropQText,
  errorText,
  mapCapText,
  markerKindOf,
  partialText,
  qIncludedText,
  searchInText,
  unlocatedHeadline,
  voucherGuide,
  areaSectionPlan,
  type SideResult,
} from '../lib/areaSearch'
import { BTN_TEXT, Badge, WarnIcon } from './ui'

export interface AreaScope {
  voucherProgram: 'svoucher' | 'dvoucher'
  age?: number
}

export type Side = { status: 'ok'; res: FacilityAreaResponse } | { status: 'failed'; message: string }

export interface AreaDone {
  bounds: AreaBounds
  q: string | null
  voucher: Side
  pub: Side
}

export type AreaState =
  | { status: 'idle' }
  | { status: 'loading'; bounds: AreaBounds; q: string | null; prev: AreaDone | null; seq: number }
  | { status: 'done'; done: AreaDone; seq: number }
  | {
      status: 'error'
      bounds: AreaBounds
      q: string | null
      code: string
      httpStatus?: number
      message: string
      // 네트워크·타임아웃·5xx·429 는 다시 시도할 가치가 있다(422 는 같은 요청이면 같은 답) — areaErrorRetryable.
      retryable: boolean
      prev: AreaDone | null
      seq: number
    }

function displayedOf(s: AreaState): AreaDone | null {
  if (s.status === 'done') return s.done
  if (s.status === 'loading' || s.status === 'error') return s.prev
  return null
}

export function areaStateBounds(s: AreaState): AreaBounds | null {
  if (s.status === 'done') return s.done.bounds
  if (s.status === 'loading' || s.status === 'error') return s.bounds
  return null
}

export function areaStateQ(s: AreaState): string | null {
  if (s.status === 'done') return s.done.q
  if (s.status === 'loading' || s.status === 'error') return s.q
  return null
}

export function sideResult(s: Side): SideResult {
  return s.status === 'ok'
    ? { status: 'ok', total: s.res.total, areas: s.res.unlocated.areas }
    : { status: 'failed' }
}

export function useAreaSearch(scope: AreaScope | undefined, resetKey: unknown) {
  const [state, setState] = useState<AreaState>({ status: 'idle' })
  const ctrl = useRef<AbortController | null>(null)
  const gen = useRef(0)
  const scopeRef = useRef(scope)
  const stateRef = useRef(state)
  useEffect(() => {
    scopeRef.current = scope
  }, [scope])
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const exit = useCallback(() => {
    ctrl.current?.abort()
    ctrl.current = null
    gen.current += 1
    setState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }))
  }, [])

  // K5: 새 판정 결과(다른 지역·조건)가 오면 범위 모드도 끝낸다.
  useEffect(() => {
    exit()
  }, [resetKey, exit])

  // K8: 언마운트 시 진행 중인 요청을 끊는다.
  useEffect(() => () => ctrl.current?.abort(), [])

  const run = useCallback((bounds: AreaBounds, q: string | null) => {
    const s = scopeRef.current
    if (!s) return
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    const g = ++gen.current
    setState((prev) => ({ status: 'loading', bounds, q, prev: displayedOf(prev), seq: g }))
    const base = {
      ...bounds,
      limit: AREA_LIMIT,
      ...(q != null ? { q } : {}),
      ...(s.age != null ? { age: s.age } : {}),
    }
    Promise.allSettled([
      searchFacilitiesInBounds({ ...base, program: s.voucherProgram }, c.signal),
      searchFacilitiesInBounds({ ...base, program: 'public' }, c.signal),
    ]).then(([v, p]) => {
      if (c.signal.aborted || ctrl.current !== c || gen.current !== g) return
      const msg = (e: unknown) => (e instanceof Error ? e.message : '찾지 못했습니다.')
      if (v.status === 'rejected' && p.status === 'rejected') {
        const e = v.reason
        const kind = e instanceof ApiCallError ? e.kind : 'unknown'
        setState((prev) => ({
          status: 'error',
          bounds,
          q,
          code: e instanceof ApiCallError ? e.code : 'UNKNOWN',
          httpStatus: e instanceof ApiCallError ? e.status : undefined,
          message: msg(e),
          retryable: areaErrorRetryable(kind),
          prev: displayedOf(prev),
          seq: g,
        }))
        return
      }
      const side = (r: PromiseSettledResult<FacilityAreaResponse>): Side =>
        r.status === 'fulfilled' ? { status: 'ok', res: r.value } : { status: 'failed', message: msg(r.reason) }
      setState({ status: 'done', done: { bounds, q, voucher: side(v), pub: side(p) }, seq: g })
    })
  }, [])

  const retry = useCallback(() => {
    const st = stateRef.current
    const b = areaStateBounds(st)
    if (!b) return
    run(b, areaStateQ(st))
  }, [run])

  const displayed = displayedOf(state)
  return { state, run, retry, exit, displayed, active: state.status !== 'idle' }
}

// 범위 결과 → 지도 점. 방어적으로 centroid 행은 버린다(범위 판정 대상이 아니다).
export function toAreaPoints(d: AreaDone): AreaMapPoint[] {
  const pts: AreaMapPoint[] = []
  for (const s of [d.voucher, d.pub]) {
    if (s.status !== 'ok') continue
    const kind = markerKindOf(s.res.program)
    for (const f of s.res.facilities) {
      if (f.coord_source === 'centroid' || f.lat == null || f.lon == null) continue
      pts.push({ id: f.id, name: f.name, lat: f.lat, lon: f.lon, kind, detail: f.sports.join(' · ') })
    }
  }
  return pts
}

// 막대에서 "{…} 안에서 찾기"를 누른 버튼이 로딩 중에도 자리를 지키게 하는 표식(포커스 유지).
export type BusyTrigger = { kind: 'retry' } | { kind: 'drop'; q: string } | null

const BAR_BTN = `${BTN_TEXT} text-left`

export function AreaSearchBar({
  state,
  voucherProgram,
  homeLabel,
  sameAsShown,
  disability,
  variant,
  barRef,
  busy,
  onReset,
  onRetry,
  onDropQ,
  onSearchArea,
  onSearchHome,
  onShowUnlocated,
}: {
  state: AreaState
  voucherProgram: FacilitySearchProgram
  homeLabel: string
  // 지금 지도 화면이 결과를 찾았던 범위와 같은가("이 지도 범위" / "찾았던 범위")
  sameAsShown: boolean
  disability: boolean
  variant: 'map' | 'list'
  barRef: RefObject<HTMLDivElement | null>
  busy: BusyTrigger
  onReset: () => void
  onRetry: (e: MouseEvent<HTMLButtonElement>) => void
  onDropQ: (e: MouseEvent<HTMLButtonElement>) => void
  onSearchArea: (a: UnlocatedArea) => void
  onSearchHome: () => void
  onShowUnlocated: () => void
}) {
  if (state.status === 'idle') return null
  const loading = state.status === 'loading'
  const q = state.status === 'done' ? state.done.q : state.q
  // 로딩 중에도 누른 버튼을 그 자리에 둔다(aria-disabled) — disabled 로 바꾸면 포커스가 날아간다.
  const showRetry =
    (state.status === 'error' && state.retryable) || (loading && busy?.kind === 'retry')
  const dropQ = state.status === 'done' && q ? q : loading && busy?.kind === 'drop' ? busy.q : null

  // 목록 탭의 막대는 스크롤 칸 맨 위 sticky 다 — data-sticky-cover 로 표시해 두면 패널의 포커스 이동이
  // 대상을 막대 **아래**로 꺼낸다(칸 안 scroll-margin-top 은 헤더 높이 72px 라 약 250px 막대를 넘지 못한다).
  const cls =
    variant === 'list'
      ? // 목록 스크롤 컨테이너(py-3)의 패딩만큼 위로(-top-3) — 패딩 띠로 아래 내용이 비치지 않게.
        'sticky -top-3 z-[1] -mt-3 mb-3 border-b border-rule bg-paper pt-3 pb-2 dark:border-rule-dark dark:bg-paper-dark'
      : 'mt-2 border-t-2 border-ink pt-2 dark:border-ink-dark'

  let title: string
  if (state.status === 'done') title = barTitle(sameAsShown)
  else if (loading) title = AREA_TEXT.loading
  else title = errorText(state.message)

  return (
    <div
      ref={barRef}
      tabIndex={-1}
      data-focus-anchor=""
      data-sticky-cover={variant === 'list' ? '' : undefined}
      data-testid="area-search-bar"
      data-status={state.status}
      className={`flex flex-col gap-1 text-ink outline-none dark:text-ink-dark ${cls}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1">
          <p
            className={
              state.status === 'error'
                ? 'inline-flex items-start gap-1.5 text-[13.5px] font-bold break-keep'
                : 'font-serif text-[15px] font-extrabold'
            }
          >
            {state.status === 'error' && <WarnIcon className="mt-0.5 h-4 w-4 shrink-0" />}
            {title}
          </p>
          {state.status === 'done' && q && (
            <span data-testid="area-search-q">
              <Badge>{qIncludedText(q)}</Badge>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3">
          {dropQ && (
            <button
              key="drop"
              type="button"
              data-testid="area-search-drop-q"
              aria-disabled={loading ? 'true' : undefined}
              aria-busy={loading ? 'true' : undefined}
              onClick={(e) => {
                if (loading) return
                onDropQ(e)
              }}
              className={BAR_BTN}
            >
              {dropQText(dropQ)}
            </button>
          )}
          {showRetry && (
            <button
              key="retry"
              type="button"
              data-testid="area-search-retry"
              aria-disabled={loading ? 'true' : undefined}
              aria-busy={loading ? 'true' : undefined}
              onClick={(e) => {
                if (loading) return
                onRetry(e)
              }}
              className={BAR_BTN}
            >
              {AREA_TEXT.retry}
            </button>
          )}
          <button
            key="reset"
            type="button"
            data-testid="area-search-reset"
            onClick={onReset}
            className={BAR_BTN}
          >
            {AREA_TEXT.reset}
          </button>
        </div>
      </div>

      {state.status === 'error' && !state.retryable && state.code === 'AREA_TOO_WIDE' && (
        <p className="text-[13px] text-mute dark:text-mute-dark">{AREA_TEXT.zoomHint}</p>
      )}
      {state.status === 'error' && !state.retryable && state.code === 'AREA_OUT_OF_RANGE' && (
        <p className="text-[13px] text-mute dark:text-mute-dark">{AREA_TEXT.outside}</p>
      )}

      {state.status === 'done' && (
        <DoneBody
          done={state.done}
          voucherProgram={voucherProgram}
          homeLabel={homeLabel}
          disability={disability}
          onSearchArea={onSearchArea}
          onSearchHome={onSearchHome}
          onShowUnlocated={onShowUnlocated}
        />
      )}
    </div>
  )
}

function DoneBody({
  done,
  voucherProgram,
  homeLabel,
  disability,
  onSearchArea,
  onSearchHome,
  onShowUnlocated,
}: {
  done: AreaDone
  voucherProgram: FacilitySearchProgram
  homeLabel: string
  disability: boolean
  onSearchArea: (a: UnlocatedArea) => void
  onSearchHome: () => void
  onShowUnlocated: () => void
}) {
  const v = done.voucher
  const p = done.pub
  const plan = areaSectionPlan(sideResult(v), sideResult(p))
  const count = (s: Side) => (s.status === 'ok' ? { status: 'ok' as const, total: s.res.total } : { status: 'failed' as const })
  const truncated = [v, p].some((s) => s.status === 'ok' && s.res.truncated)
  const plotted = [v, p].reduce((n, s) => n + (s.status === 'ok' ? s.res.facilities.length : 0), 0)
  const vAreas = v.status === 'ok' ? v.res.unlocated.areas : []
  const note = 'flex flex-wrap items-center justify-between gap-x-3 text-[13px] leading-[1.6] break-keep'
  return (
    <>
      <p data-testid="area-search-counts" className="text-[14px] font-bold">
        {barCounts(voucherProgram, count(v), count(p))}
      </p>
      <p className="text-[12px] leading-[1.6] text-mute dark:text-mute-dark">{AREA_TEXT.barSub}</p>
      {truncated && (
        <p data-testid="area-search-map-cap" className="text-[12px] leading-[1.6] text-mute dark:text-mute-dark">
          {mapCapText(plotted)}
        </p>
      )}
      {v.status === 'ok' && vAreas.length > 0 && (
        <div data-testid="area-unlocated" className={note}>
          <p className="min-w-0">{unlocatedHeadline(voucherProgram, vAreas, done.q, 'bar')}</p>
          {vAreas.length === 1 ? (
            <button type="button" onClick={() => onSearchArea(vAreas[0])} className={BAR_BTN}>
              {searchInText(vAreas[0].display_label)}
            </button>
          ) : (
            <button type="button" onClick={onShowUnlocated} className={BAR_BTN}>
              {AREA_TEXT.unlocatedMore}
            </button>
          )}
        </div>
      )}
      {plan.voucher.kind === 'zero+guide' && (
        <div data-testid="area-voucher-guide" className={note}>
          <p className="min-w-0">{voucherGuide(voucherProgram)}</p>
          <button type="button" onClick={onSearchHome} className={BAR_BTN}>
            {searchInText(homeLabel)}
          </button>
        </div>
      )}
      {plan.neutral && (
        <div data-testid="area-search-zero" className={note}>
          <p className="min-w-0">{AREA_TEXT.neutralZero}</p>
          <button type="button" onClick={onSearchHome} className={BAR_BTN}>
            {searchInText(homeLabel)}
          </button>
        </div>
      )}
      {/* 공공 쪽이 실패했으면 두지 않는다 — "공공·대안은 모두 보여요"가 바로 옆 "공공·대안 시설 찾기가 실패해
          …만 보여요"와 서로 반박한다(부분 실패 격리: 실패한 쪽에는 0건 문구·안내를 두지 않는다, SPEC §0). */}
      {disability && p.status === 'ok' && (
        <p data-testid="area-bar-disability-note" className="text-[12px] leading-[1.6] text-mute dark:text-mute-dark">
          {AREA_TEXT.barDisability}
        </p>
      )}
      {(v.status === 'failed' || p.status === 'failed') && (
        <p data-testid="area-search-partial" className="inline-flex items-start gap-1.5 text-[13px] leading-[1.6]">
          <WarnIcon className="mt-0.5 h-4 w-4 shrink-0" />
          {partialText(voucherProgram, v.status === 'failed' ? 'voucher' : 'public')}
        </p>
      )}
    </>
  )
}

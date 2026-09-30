// 컨텍스트 패널: 데스크톱(lg) 우측 고정 컬럼 · 모바일 상단 접이식 시트.
// 지도(MapLibre GL)는 여기 단 하나만 상주한다(메시지별 재마운트 금지, ARCHITECTURE §11.4).
// 패널이 없어도 스트림만으로 정보가 완결되므로(FR-12 AC3), 여기는 "더 크게 보는 곳"이다.
//
// 이 패널이 두 검색 상태를 소유한다(계약서 §6.6·§6.7):
//   · 키워드 검색(useFacilitySearch) — 내 시군구(또는 덮어쓴 시군구) 안에서 이름·주소로
//   · 지도 범위 검색(useAreaSearch) — "이 지역에서 다시 찾기"
//   목록 탭 표시 우선순위: 범위 결과 > 키워드 결과 > 근처 기본 목록.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, RefObject } from 'react'
import type { AssessRequest, AssessResponse } from '../types'
import type { PanelTab } from '../types_chat'
import { NearbyMap, type MapLocate, type NearbyMapArea } from '../components/NearbyMap'
import { NearbyList, type AreaListView, type KeywordControls } from '../components/NearbyList'
import { useFacilitySearch, viaOfClick, type InputVia } from '../components/FacilitySearch'
import {
  AreaSearchBar,
  areaStateBounds,
  areaStateQ,
  sideResult,
  toAreaPoints,
  useAreaSearch,
  type AreaScope,
  type BusyTrigger,
} from '../components/AreaSearch'
import type { AreaBounds, FacilitySearchScope, SearchMapPoint, UnlocatedArea } from '../types_search'
import { Badge } from '../components/ui'
import { altPoolLabel, countMatching, poolCountText } from '../lib/sports'
import {
  AREA_TEXT,
  doneAnnouncement,
  errorText,
  sameBounds,
  scopeOverrideHelp,
  scopeOverridePrompt,
} from '../lib/areaSearch'
import { revealDelta } from '../lib/reveal'
import { stickyRegionMaxHeight } from '../lib/panelFit'
import { facilityCountText } from './messages'
import { personLocOf } from './policy'

// 키워드 결과가 비었을 때 지도에 넘기는 점 — 매번 새 빈 배열을 만들면 지도 마커 효과가 괜히 다시 돈다.
const EMPTY_POINTS: SearchMapPoint[] = []

// 데스크톱 범위 모드 지도 탭의 막대 칸 최소 높이(rem) — 짧은 화면 + 글씨 크게에서도 막대 머리 줄(제목·원래 결과로)은 보인다.
const MAP_BAR_MIN_REM = 4.5

// 같은 문구가 연속되면 비웠다가 다음 프레임에 채운다(스크린리더가 같은 텍스트 변경을 무시하지 않게).
function useAnnouncer(): [string, (msg: string) => void] {
  const [text, setText] = useState('')
  const cur = useRef('')
  const announce = useCallback((msg: string) => {
    if (msg === cur.current) {
      setText('')
      requestAnimationFrame(() => setText(msg))
      return
    }
    cur.current = msg
    setText(msg)
  }, [])
  return [text, announce]
}

// 창의 sticky 헤더(제호). 카드 안의 <header>(EligibilityCard 등)와 가르려고 sticky 인 것을 고른다.
function stickyHeaderBottom(): number {
  for (const h of document.querySelectorAll('header')) {
    if (getComputedStyle(h).position === 'sticky') return Math.max(0, h.getBoundingClientRect().bottom)
  }
  return 0
}

// 포커스한 대상이 가려져 있으면 보이는 띠 안으로 꺼낸다(§6.11 "탭 전환 + 포커스"의 가림 보강).
//   1) 스크롤 칸(data-reveal-scroller — 목록 탭 · 데스크톱 지도 탭의 막대 칸) 안이면: 칸 윗변 ~ 칸 안 sticky 막대
//      (data-sticky-cover) 아랫변이 가려진 띠다. scroll-margin-top(헤더 높이)만으로는 약 250px 막대를 넘지 못한다.
//   2) 창: sticky 헤더 밑(0 ≤ top < 헤더 바닥)에 걸린 대상은 뷰포트 "안"이라 "밖이면 scrollIntoView"로는 안 굴러간다.
// 포커스 이동에 따른 스크롤이므로 즉시(instant) — html 의 scroll-behavior:smooth 를 타지 않는다.
function revealFocused(el: HTMLElement) {
  const sc = el.parentElement?.closest<HTMLElement>('[data-reveal-scroller]')
  if (sc && sc.scrollHeight > sc.clientHeight + 1) {
    const cr = sc.getBoundingClientRect()
    let top = cr.top + sc.clientTop
    for (const cover of sc.querySelectorAll<HTMLElement>('[data-sticky-cover]')) {
      if (cover === el || cover.contains(el)) continue
      const r = cover.getBoundingClientRect()
      if (r.height > 0 && r.bottom > top) top = r.bottom
    }
    const d = revealDelta(el.getBoundingClientRect(), { top, bottom: cr.top + sc.clientTop + sc.clientHeight })
    if (d !== 0) sc.scrollTop += d
  }
  const d = revealDelta(el.getBoundingClientRect(), { top: stickyHeaderBottom(), bottom: window.innerHeight })
  if (d !== 0) window.scrollBy({ top: d, behavior: 'instant' })
}

// 탭 전환·재마운트가 반영된 다음 프레임에 포커스(화면은 굴리지 않고), 가려져 있으면 꺼낸다.
function focusNextFrame(get: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => {
    const el = get()
    if (!el) return
    el.focus({ preventScroll: true })
    revealFocused(el)
  })
}

function viaOf(e: MouseEvent<HTMLElement>): InputVia {
  return viaOfClick(e)
}

function normalizeQ(raw: string): string | null {
  const q = raw.split(/\s+/).filter(Boolean).join(' ')
  return q.length === 0 || q.length > 30 ? null : q
}

export function ContextPanel({
  req,
  data,
  open,
  tab,
  filterSports,
  anchorRef,
  onToggle,
  onTab,
  onClearFilter,
  locate,
  onLocate,
}: {
  req: AssessRequest
  data: AssessResponse
  open: boolean
  tab: PanelTab
  filterSports?: string[]
  // 셸이 "패널로 데려가기"를 할 때 위치를 재는 앵커(v1.7).
  anchorRef?: RefObject<HTMLDivElement | null>
  onToggle: (open: boolean) => void
  onTab: (tab: PanelTab) => void
  onClearFilter: () => void
  // 시설 목록 → 지도 확대(요청 1건당 seq 1 증가).
  locate?: MapLocate | null
  onLocate?: (id: string) => void
}) {
  const baseId = useId()
  const mapPanelId = `${baseId}-map`
  const listPanelId = `${baseId}-list`
  // C-4: 아래 목록이 종목 필터로 줄어 있으면 배지도 그 사실을 함께 말한다 —
  // 필터 걸린 목록 위에 전체 수만 떠 있으면 두 숫자가 서로 반박하는 것처럼 읽힌다(P-1).
  const altCounts = countMatching(data.nearby.alternatives, filterSports)
  // 장애 있음 결과의 공공·대안 풀은 원천 '장애' 표기 시설만 센 수다 — 배지가 그 기준을 함께 말한다.
  const disabilityFiltered = req.disability.has
  const hasPublicProgram = (data.alt_edges ?? []).some((e) => e.to === 'public_program')
  const voucherProgram: 'svoucher' | 'dvoucher' = req.disability.has ? 'dvoucher' : 'svoucher'
  const homeLabel = req.sigungu_nm || '내 지역'

  // 동·도로명·시설명 검색(현재 결과의 시군구 안). 실좌표 결과만 지도에 얹는다.
  const searchScope = useMemo<FacilitySearchScope | undefined>(
    () =>
      req.sigungu_cd
        ? {
            sigungu_cd: req.sigungu_cd,
            sigungu_nm: req.sigungu_nm,
            voucherProgram: req.disability.has ? 'dvoucher' : 'svoucher',
            origin: req.location ?? null,
            age: req.age,
          }
        : undefined,
    [req],
  )
  const areaScope = useMemo<AreaScope>(
    () => ({ voucherProgram: req.disability.has ? 'dvoucher' : 'svoucher', age: req.age }),
    [req],
  )

  const keyword = useFacilitySearch(searchScope, data.nearby)
  const area = useAreaSearch(areaScope, data.nearby)
  // K6: 다른 시군구 안에서 찾기(검색 범위 덮어쓰기). 이 동안에는 거리를 쓰지 않는다.
  const [scopeOverride, setScopeOverride] = useState<{ sigungu_cd: string; label: string } | null>(null)
  // 지도가 마지막으로 멈춘 범위(막대 제목 "이 지도 범위 / 찾았던 범위")
  const [viewBounds, setViewBounds] = useState<AreaBounds | null>(null)
  // 검색 폼 다시 마운트(모드가 바뀔 때 입력칸 값을 되돌린다)
  const [formReset, setFormReset] = useState({ seq: 0, value: '' })
  const [busy, setBusy] = useState<BusyTrigger>(null)
  // 지금 진행 중인 범위 요청을 시작한 입력 방식 — 완료 뒤 막대로 포커스를 옮길 때 화면을 굴릴지 정한다(§6.11).
  // 요청을 시작하는 모든 경로(오버레이 버튼·폼 제출 K2·검색 지우기 K3·q 빼기·다시 시도)가 매번 갱신한다.
  const viaRef = useRef<InputVia>('pointer')
  const inputRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const listPanelRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  // 지도 탭의 결과 막대 칸(지도 아래). 데스크톱 범위 모드에서만 높이 한도 + 자체 스크롤.
  const mapBarRegionRef = useRef<HTMLDivElement>(null)
  const [statusText, announce] = useAnnouncer()

  // K5: 새 판정 결과 → 범위 모드·키워드는 각 훅이 끝낸다. 덮어쓰기와 입력칸도 되돌린다.
  useEffect(() => {
    setScopeOverride(null)
    setBusy(null)
    setFormReset((r) => ({ seq: r.seq + 1, value: '' }))
  }, [data.nearby])

  const overrideScopeOf = useCallback(
    (ov: { sigungu_cd: string; label: string }): FacilitySearchScope | undefined =>
      searchScope
        ? { ...searchScope, sigungu_cd: ov.sigungu_cd, sigungu_nm: ov.label, origin: null, override: true }
        : undefined,
    [searchScope],
  )

  const keywordQ =
    keyword.state.status === 'idle'
      ? null
      : keyword.state.status === 'done'
        ? keyword.state.result.q
        : keyword.state.q

  // 키워드 결과 → 지도 점(실좌표 행만 — 근사 행은 지도에 찍지 않는다, P-1).
  const keywordPoints = useMemo<SearchMapPoint[]>(() => {
    if (keyword.state.status !== 'done') return EMPTY_POINTS
    const r = keyword.state.result
    const pts: SearchMapPoint[] = []
    for (const v of r.vouchers) {
      if (v.coord_source === 'centroid' || v.lat == null || v.lon == null) continue
      pts.push({
        id: v.id,
        name: v.name,
        lat: v.lat,
        lon: v.lon,
        kind: v.source === 'dvoucher' ? 'dvoucher' : 'voucher',
        dist_km: v.dist_km,
        detail: v.sports.join(' · '),
      })
    }
    for (const a of r.alts) {
      if (a.coord_source === 'centroid' || a.lat == null || a.lon == null) continue
      pts.push({
        id: a.id,
        name: a.name,
        lat: a.lat,
        lon: a.lon,
        kind: 'public',
        dist_km: a.dist_km,
        detail: a.sports.join(' · '),
      })
    }
    return pts.length > 0 ? pts : EMPTY_POINTS
  }, [keyword.state])

  const areaPoints = useMemo(() => (area.displayed ? toAreaPoints(area.displayed) : null), [area.displayed])
  const mapArea: NearbyMapArea = {
    active: area.active,
    loading: area.state.status === 'loading',
    shownBounds: area.displayed?.bounds ?? null,
    points: areaPoints,
    reqId: area.state.status === 'idle' ? undefined : area.state.seq,
  }

  // ── 목록 내용이 통째로 바뀌면 스크롤 칸을 맨 위로 ─────────────────────────────
  //   범위 결과 도착·교체(K2·K3·q 빼기·다시 시도) · 원래 결과로(K4) · 다른 시군구 찾기(K6) — 목록 탭 패널은
  //   언마운트되지 않고 hidden 만 토글된다. Chromium 은 display:none 동안의 scrollTop 을 기억했다가 다시 보일 때
  //   되돌리므로, 근처 목록을 내려 보던 자리(예: 1114px)에서 새 결과가 시작돼 h2 '지도 범위 결과'·폼·섹션 머리·
  //   1~7행이 sticky 막대 뒤나 화면 밖에 숨고 8행이 첫 결과처럼 읽혔다. 숨은 동안은 scrollTop 을 쓸 수 없으므로
  //   "되돌릴 일"을 기억해 두고, 보이는 커밋(탭 전환·시트 펼침)의 페인트 전에 맨 위로 되돌린다.
  //   데스크톱 지도 탭의 막대 칸(범위 모드 자체 스크롤)도 결과가 바뀌면 같은 이유로 맨 위에서 시작한다.
  const listContent: unknown = area.displayed ?? (keyword.state.status === 'idle' ? 'near' : 'keyword')
  const mapBarContent: unknown = area.displayed
  const seenContent = useRef({ list: listContent, mapBar: mapBarContent })
  const resetPending = useRef({ list: false, mapBar: false })
  useLayoutEffect(() => {
    const seen = seenContent.current
    const pending = resetPending.current
    if (!Object.is(seen.list, listContent)) {
      seen.list = listContent
      pending.list = true
    }
    if (!Object.is(seen.mapBar, mapBarContent)) {
      seen.mapBar = mapBarContent
      pending.mapBar = true
    }
    const shown = (el: HTMLElement | null): el is HTMLElement => el != null && el.getClientRects().length > 0
    const list = listPanelRef.current
    if (pending.list && tab === 'list' && shown(list)) {
      list.scrollTop = 0
      pending.list = false
    }
    const region = mapBarRegionRef.current
    if (pending.mapBar && tab === 'map' && shown(region)) {
      region.scrollTop = 0
      pending.mapBar = false
    }
  }, [listContent, mapBarContent, tab, open])

  // ── 데스크톱 범위 모드: 지도 탭 막대 칸의 높이 한도(lib/panelFit) ─────────────────
  //   지도·범례는 칸 **밖**이다 — 칸에 폭을 차지하는 스크롤바(Windows 기본, macOS "항상 보기")가 생겨도 지도 폭이
  //   그대로라 앱 RO 의 resize 로 보이는 범위가 좁아지지 않는다(검색 직후 제목이 '찾았던 범위'로 뜨고, 재검색마다
  //   지도가 좌우로 15px 출렁이던 결함). 범위 모드가 아니면 한도도 스크롤도 없다 — 기본 지도 탭(범례·ⓘ)을
  //   내부 스크롤 뒤로 숨기지 않는다.
  const [mapBarMax, setMapBarMax] = useState<number | null>(null)
  const mapBarLimited = area.active && tab === 'map'
  useLayoutEffect(() => {
    const aside = asideRef.current
    const region = mapBarRegionRef.current
    if (!mapBarLimited || !aside || !region) {
      setMapBarMax(null)
      return
    }
    const measure = () => {
      const cs = getComputedStyle(aside)
      // 모바일(<lg)은 패널이 문서 흐름 속(sticky 아님) — 한도가 필요 없다.
      if (cs.position !== 'sticky') {
        setMapBarMax(null)
        return
      }
      const doc = document.documentElement
      const ar = aside.getBoundingClientRect()
      const rr = region.getBoundingClientRect()
      const container = aside.parentElement
      const belowContainer = container
        ? doc.scrollHeight - (container.getBoundingClientRect().bottom + window.scrollY)
        : 0
      const rootPx = parseFloat(getComputedStyle(doc).fontSize) || 16
      setMapBarMax(
        stickyRegionMaxHeight({
          viewportH: window.innerHeight,
          stickyTop: parseFloat(cs.top) || 0,
          belowContainer,
          above: rr.top - ar.top,
          below: ar.bottom - rr.bottom,
          minPx: MAP_BAR_MIN_REM * rootPx,
        }),
      )
    }
    measure()
    // 머리 줄바꿈·"글씨 크게"·지도 높이(sm:h-80) 변화는 패널 높이 변화로 잡힌다. 칸 높이만 바뀐 경우에도 불리지만
    // 잰 값은 칸 높이와 무관하므로 같은 값이 나와 다시 그리지 않는다.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(aside)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [mapBarLimited])

  // ── 범위 요청이 끝날 때: 낭독 + 막대로 포커스(완료·오류·부분 실패 모두) ─────────────
  const handledSeq = useRef(0)
  useEffect(() => {
    const st = area.state
    if (st.status !== 'done' && st.status !== 'error') return
    if (st.seq === handledSeq.current) return
    handledSeq.current = st.seq
    setBusy(null)
    if (st.status === 'done') {
      announce(doneAnnouncement(voucherProgram, sideResult(st.done.voucher), sideResult(st.done.pub)))
    } else {
      announce(errorText(st.message))
    }
    // 포인터로 시작했으면 화면을 움직이지 않고, 키보드면 기본 스크롤(scroll-margin-top 적용).
    barRef.current?.focus(viaRef.current === 'pointer' ? { preventScroll: true } : undefined)
  }, [area.state, announce, voucherProgram])

  // K1: 오버레이 버튼 — q 는 범위 모드면 현재 범위 q, 아니면 진행·완료·오류 중인 키워드 q.
  const onAreaSearch = (b: AreaBounds, via: InputVia) => {
    const q = area.active ? areaStateQ(area.state) : keywordQ
    viaRef.current = via
    setBusy(null)
    if (!area.active) setFormReset((r) => ({ seq: r.seq + 1, value: q ?? '' }))
    area.run(b, q)
  }

  // 폼 제출: K2(범위 모드면 같은 범위를 새 q 로 — 지도는 움직이지 않는다) / 덮어쓴 범위 / 내 시군구.
  // via 는 폼이 가려 준다(찾기 버튼을 마우스로 누르면 pointer, 입력칸 Enter 면 keyboard) — 고정하면
  // 마우스로 누른 제출도 완료 뒤 포커스가 창을 굴린다.
  const onFormSubmit = (raw: string, via: InputVia) => {
    if (area.active) {
      const b = areaStateBounds(area.state)
      const q = normalizeQ(raw)
      if (!b || !q) return
      viaRef.current = via
      setBusy(null)
      area.run(b, q)
      return
    }
    if (scopeOverride) keyword.run(raw, overrideScopeOf(scopeOverride))
    else keyword.run(raw)
  }

  // K3: 범위 모드의 "검색 지우기" → 같은 범위를 q 없이. 아니면 키워드를 지운다.
  // 이 요청도 시작 방식을 기록한다 — 안 하면 직전 다른 동작의 방식을 이어 써서 스크롤이 어긋난다.
  const onFormClear = (via: InputVia) => {
    if (area.active) {
      const b = areaStateBounds(area.state)
      if (!b) return
      viaRef.current = via
      setBusy(null)
      area.run(b, null)
      return
    }
    keyword.clear()
  }

  const onDropQ = (e: MouseEvent<HTMLButtonElement>) => {
    const b = areaStateBounds(area.state)
    const q = areaStateQ(area.state)
    if (!b || !q) return
    viaRef.current = viaOf(e)
    setBusy({ kind: 'drop', q })
    setFormReset((r) => ({ seq: r.seq + 1, value: '' }))
    area.run(b, null)
  }

  const onRetry = (e: MouseEvent<HTMLButtonElement>) => {
    viaRef.current = viaOf(e)
    setBusy({ kind: 'retry' })
    area.retry()
  }

  const tabButtonId = (t: PanelTab) => (t === 'map' ? `${mapPanelId}-tab` : `${listPanelId}-tab`)

  // K4: 원래 결과로 — 키워드가 켜져 있으면 키워드 결과로, 아니면 근처 목록으로. 지도는 다시 맞춘다.
  const onReset = () => {
    area.exit()
    setBusy(null)
    setFormReset((r) => ({ seq: r.seq + 1, value: keywordQ ?? '' }))
    announce(AREA_TEXT.resetAnnounce)
    focusNextFrame(() => document.getElementById(tabButtonId(tab)))
  }

  // K6: 위치 미상 항목의 "주소로 찾기" · 막대의 "{…} 안에서 찾기" · 일반 안내의 "{내 시군구} 안에서 찾기".
  const searchIn = (target: UnlocatedArea | 'home') => {
    const q = areaStateQ(area.state)
    area.exit()
    setBusy(null)
    onTab('list')
    const home = req.sigungu_cd
    const isHome =
      target === 'home' || target.sigungu_cd === home || (home != null && target.scope_codes.includes(home))
    if (isHome) {
      setScopeOverride(null)
      if (q && searchScope) keyword.run(q, searchScope)
      else keyword.clear()
    } else {
      const ov = { sigungu_cd: target.sigungu_cd, label: target.display_label }
      setScopeOverride(ov)
      const s = overrideScopeOf(ov)
      if (q && s) keyword.run(q, s)
      else keyword.clear()
    }
    setFormReset((r) => ({ seq: r.seq + 1, value: q ?? '' }))
    focusNextFrame(() => inputRef.current)
  }

  // K7: 내 지역으로 — 덮어쓰기 해제 + 키워드 결과 지우기. 입력칸의 q 는 남긴다.
  const onScopeReset = () => {
    setScopeOverride(null)
    keyword.clear()
    focusNextFrame(() => inputRef.current)
  }

  // 막대 "위치 확인 안 된 곳 보기"(영역 여럿) → 목록 탭의 이용권 위치 미상 블록으로.
  const onShowUnlocated = () => {
    onTab('list')
    focusNextFrame(() =>
      listPanelRef.current?.querySelector<HTMLElement>(
        `[data-testid="area-unlocated-block"][data-program="${voucherProgram}"]`,
      ),
    )
  }

  const keywordControls: KeywordControls | undefined = searchScope
    ? {
        state: keyword.state,
        statusSuppressed: area.displayed != null,
        // K6 덮어쓰기 중 검색어 전: 내 지역 목록 대신 안내(범위 모드면 범위 결과가 먼저라 해당 없음).
        scopePrompt:
          scopeOverride && !area.active && keyword.state.status === 'idle'
            ? scopeOverridePrompt(scopeOverride.label)
            : null,
        form: {
          sigunguLabel: searchScope.sigungu_nm,
          help: area.active
            ? AREA_TEXT.formHelp
            : scopeOverride
              ? scopeOverrideHelp(scopeOverride.label)
              : undefined,
          busy: area.active ? area.state.status === 'loading' : keyword.state.status === 'loading',
          active: area.active ? areaStateQ(area.state) != null : keyword.state.status !== 'idle',
          onSubmit: onFormSubmit,
          onClear: onFormClear,
          formKey: formReset.seq,
          initialValue: formReset.value,
          inputRef,
          onScopeReset: scopeOverride && !area.active ? onScopeReset : undefined,
        },
      }
    : undefined

  const areaListView: AreaListView | null = area.displayed
    ? {
        done: area.displayed,
        voucherProgram,
        homeLabel,
        disability: req.disability.has,
        onSearchArea: (a) => searchIn(a),
        onSearchHome: () => searchIn('home'),
      }
    : null

  const bar = (variant: 'map' | 'list') => (
    <AreaSearchBar
      state={area.state}
      voucherProgram={voucherProgram}
      homeLabel={homeLabel}
      sameAsShown={sameBounds(viewBounds, area.displayed?.bounds)}
      disability={req.disability.has}
      variant={variant}
      barRef={barRef}
      busy={busy}
      onReset={onReset}
      onRetry={onRetry}
      onDropQ={onDropQ}
      onSearchArea={(a) => searchIn(a)}
      onSearchHome={() => searchIn('home')}
      onShowUnlocated={onShowUnlocated}
    />
  )

  return (
    <aside
      ref={asideRef}
      data-testid="context-panel"
      aria-label="근처 자원 패널"
      className="order-1 w-full min-w-0 lg:order-2 lg:sticky lg:top-[4.5rem] lg:w-[38%] lg:shrink-0"
    >
      {/* 범위 검색 낭독(완료·오류·부분 실패·되돌림) — 접히는 본문 밖에 항상 마운트. 막대에는 role 을 주지 않는다. */}
      <p data-testid="area-search-status" role="status" aria-live="polite" className="sr-only">
        {statusText}
      </p>
      <div
        ref={anchorRef}
        className="border-t-2 border-ink bg-paper dark:border-ink-dark dark:bg-paper-dark"
      >
        {/* 요약 바 — 모바일에서는 접힘 상태의 존재감, 데스크톱에서는 헤더 */}
        <div className="relative flex flex-wrap items-center justify-between gap-2 border-b border-rule py-2.5 dark:border-rule-dark">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="font-serif text-[16px] font-extrabold text-ink dark:text-ink-dark">근처 자원</span>
            {/* FR-04 AC6: 잘린 목록 길이를 구 단위 카운트인 척 쓰지 않는다(요약 바도 같은 문구) */}
            <Badge tone="brand">{facilityCountText(req, data)}</Badge>
            <Badge tone="ok">
              <span data-testid="panel-alt-count">{poolCountText(altPoolLabel(disabilityFiltered), altCounts)}</span>
            </Badge>
          </div>
          {/* 범위 모드에서도 배지는 내 지역 판정 기준 그대로다 — 기준이 다르다는 것을 밝힌다.
              요약 바 아래 괘선 위에 얹는 꼬리표(absolute) — 390 에서 배지 줄에 끼우면 줄이 넘쳐
              요약 바가 자라고 지도가 밀린다(지도 y 고정 계약). 읽는 순서는 배지 바로 다음이다. */}
          {area.active && (
            <span
              data-testid="panel-count-basis"
              className="pointer-events-none absolute right-0 -bottom-2.5 z-[1] bg-paper px-1.5 text-[12px] leading-[18px] text-mute dark:bg-paper-dark dark:text-mute-dark"
            >
              {AREA_TEXT.panelBasis}
            </span>
          )}
          <button
            type="button"
            data-testid="panel-toggle"
            onClick={() => onToggle(!open)}
            aria-expanded={open}
            aria-controls={`${baseId}-body`}
            className="press inline-flex min-h-11 items-center bg-transparent text-[13px] text-mute underline decoration-1 underline-offset-4 hover:text-ink lg:hidden dark:text-mute-dark dark:hover:text-ink-dark"
          >
            {open ? '접기' : '지도·목록 펼치기'}
          </button>
        </div>

        {/* 본문 — 모바일은 접힘 가능, 데스크톱(lg)은 상시 표시.
            나타날 때만 위에서 아래로 슬라이드(sheet-slide-down, 240ms ease-out).
            접힘은 display:none 이라 애니메이션 없이 즉시 사라진다 —
            숨김을 transform 으로 흉내내지 않으므로 접힌 본문은 포커스·낭독 대상에서도 빠진다. */}
        <div
          id={`${baseId}-body`}
          data-testid="panel-body"
          className={open ? 'sheet-slide-down block' : 'hidden lg:block'}
        >
          <div role="tablist" aria-label="패널 보기 전환" className="flex gap-5 pt-3">
            <button
              type="button"
              role="tab"
              id={`${mapPanelId}-tab`}
              aria-selected={tab === 'map'}
              aria-controls={mapPanelId}
              data-testid="panel-tab-map"
              onClick={() => onTab('map')}
              className={
                'font-serif min-h-11 bg-transparent px-0.5 text-[16px] font-extrabold ' +
                (tab === 'map'
                  ? 'border-b-[2.5px] border-ink text-ink dark:border-ink-dark dark:text-ink-dark'
                  : 'border-b-[2.5px] border-transparent text-mute hover:text-ink dark:text-mute-dark dark:hover:text-ink-dark')
              }
            >
              지도
            </button>
            <button
              type="button"
              role="tab"
              id={`${listPanelId}-tab`}
              aria-selected={tab === 'list'}
              aria-controls={listPanelId}
              data-testid="panel-tab-list"
              onClick={() => onTab('list')}
              className={
                'font-serif min-h-11 bg-transparent px-0.5 text-[16px] font-extrabold ' +
                (tab === 'list'
                  ? 'border-b-[2.5px] border-ink text-ink dark:border-ink-dark dark:text-ink-dark'
                  : 'border-b-[2.5px] border-transparent text-mute hover:text-ink dark:text-mute-dark dark:hover:text-ink-dark')
              }
            >
              시설 목록
            </button>
          </div>

          {/* 지도 패널: 언마운트하지 않는다(1인스턴스 유지) — 숨김만 한다.
              데스크톱(lg) 범위 모드에서는 지도 **아래의 막대 칸만** 높이 한도 + 자체 스크롤(mapBarMax). 패널은 lg:sticky 라
              한도가 없으면 결과 막대(약 190~290px)만큼 패널이 뷰포트보다 길어지고, 대화 바닥(기본 상태)에서는 sticky
              패널이 컨테이너 바닥에 밀려 위로 올라가 지도·탭·± 버튼·"이 지역에서 다시 찾기"가 sticky 헤더 밑으로 들어간다
              (1280x720 에서 135px). 지도·범례를 스크롤 칸 밖에 두는 이유: 칸에 폭을 차지하는 스크롤바가 생겨도 지도 폭과
              보이는 범위가 변하지 않는다. 범위 모드가 아니면 한도가 없어 기본 지도 탭은 HEAD 와 같다(범례·ⓘ 가림 없음). */}
          <div
            role="tabpanel"
            id={mapPanelId}
            aria-labelledby={`${mapPanelId}-tab`}
            hidden={tab !== 'map'}
            className="py-3"
          >
            <NearbyMap
              personLoc={personLocOf(req)}
              nearby={data.nearby}
              locate={locate}
              extraPoints={keywordPoints}
              area={mapArea}
              onAreaSearch={onAreaSearch}
              onViewBounds={setViewBounds}
            />
            {/* 결과 막대는 지도 **아래** — 지도의 y 위치를 밀지 않는다. 한 번에 한 곳에만 그린다.
                안내 문구도 칸 안(맨 끝)에 둔다 — 칸 밖이면 그 높이만큼 짧은 화면에서 막대 칸이 줄어든다. */}
            <div
              ref={mapBarRegionRef}
              data-testid="map-bar-region"
              data-reveal-scroller=""
              className={mapBarMax != null ? 'overflow-y-auto' : undefined}
              style={mapBarMax != null ? { maxHeight: mapBarMax } : undefined}
            >
              {tab === 'map' && bar('map')}
              <p className="mt-2 text-xs text-mute dark:text-mute-dark">
                지도 없이도 같은 정보를 시설 목록과 대화 카드에서 확인하실 수 있어요.
              </p>
            </div>
          </div>

          <div
            ref={listPanelRef}
            data-reveal-scroller=""
            role="tabpanel"
            id={listPanelId}
            aria-labelledby={`${listPanelId}-tab`}
            hidden={tab !== 'list'}
            className="max-h-[70dvh] overflow-y-auto py-3 lg:max-h-[calc(100dvh-16rem)]"
          >
            {/* 목록 탭에서는 스크롤 컨테이너 맨 위 sticky — 데스크톱 sticky 패널이 넘치지 않는다. */}
            {tab === 'list' && bar('list')}
            <NearbyList
              nearby={data.nearby}
              filterSports={filterSports}
              onClearFilter={onClearFilter}
              onLocate={onLocate}
              keyword={keywordControls}
              area={areaListView}
              disabilityFiltered={disabilityFiltered}
              hasPublicProgram={hasPublicProgram}
            />
          </div>
        </div>
      </div>
    </aside>
  )
}

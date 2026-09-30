// 근처 자원 지도 — MapLibre GL + OpenFreeMap 벡터 타일(v1.8).
//   래스터(Leaflet+OSM 타일 서버) → 벡터(OpenFreeMap)로 교체. 키·등록 불필요이고
//   저작자표시(OSM/OpenMapTiles/OpenFreeMap)는 AttributionControl 이 소유한다(제거 금지).
//   react 래퍼 없이 useRef+useEffect 로 직접 제어한다 — 패널 상주 1인스턴스라
//   재마운트 없이 markers/fitBounds/resize 만 갱신하면 된다(ARCHITECTURE §11.4).
//
// "이 지역에서 다시 찾기"(계약서 §6.3~6.5):
//   · 사용자가 지도를 직접 움직였을 때만 지도 위 가운데에 버튼이 뜬다. 앱이 카메라를 옮기는 동안
//     (fitBounds·flyTo·jumpTo)과 앱이 resize() 를 부르는 동안은 가드로 표시해 사용자 이동과 가른다.
//     MapLibre 자체 ResizeObserver 는 끈다(trackResize:false) — resize() 경로는 앱의 RO 하나뿐이다.
//     앱의 이동은 **시작하는 순간** 버튼을 거둔다(지목 flyTo 는 약 0.7초 — 끝날 때 거두면 비행 내내 낡은 버튼이
//     보이고 눌린다). 카메라가 그대로인 "사용자 이동"(막아 둔 Shift+화살표, 줌 한계의 ±)은 이동으로 세지 않는다.
//   · 범위 결과를 보이는 동안 기존 마커('내 위치' 포함)는 내린다 — 시군구 중심점·서울시청인 '내 위치'가
//     남아 있으면 범위 안의 실제 위치처럼 읽힌다. 범위 결과는 화면 맞춤을 하지 않는다(지도가 움직이지 않는다).
//   · 같은 종류·같은 좌표의 시설은 한 마커로 묶고 개수를 적는다 — 좌표를 흩뜨려 없는 위치를 만들지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
} from 'maplibre-gl'
import type { LatLon, Nearby } from '../types'
import type { AreaBounds, AreaMapPoint, SearchMapPoint } from '../types_search'
import { km, markerColor } from '../lib/format'
import {
  AREA_TEXT,
  areaControlState,
  areaGate,
  cameraMoved,
  classifyMoveStart,
  sameBounds,
  settleAfterRequest,
  toAreaBounds,
  type AreaControl,
  type AreaGate,
  type CameraSnap,
  type LastMove,
  type MoveClass,
} from '../lib/areaSearch'

// 스타일: 라이트=positron / 다크=dark (OpenFreeMap 제공, 서로 짝인 저채도 페어).
// 저채도 베이스맵을 고른 이유 = 마커 3색(파랑·초록·보라)이 배경과 경쟁하지 않게 하려고.
// (liberty/bright 는 공원 초록·물 파랑이 진해 같은 색 마커를 삼킨다.)
const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron'
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark'

// 저작자표시(필수) — 타일이 못 와도 남아야 하므로 소스(TileJSON) 표기에 기대지 않고 직접 넣는다.
// AttributionControl 은 "다른 항목의 부분문자열"인 항목을 지운다. 그래서 뒤 둘은
// OpenFreeMap TileJSON 의 표기 문자열과 **글자 그대로** 맞춰 두었다 —
// 온라인이면 소스 표기 한 줄로 합쳐지고, 오프라인이면 이 둘이 그대로 남는다.
// (제공자가 문구를 바꾸면 중복 표기가 될 뿐, 표기가 사라지지는 않는다.)
const ATTRIBUTION = [
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 기여자',
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a>',
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a>',
]

// 지도 UI 문자열 한국어화(캔버스 aria-label · 협조 제스처 안내 · 저작자표시 토글).
const LOCALE = {
  'Map.Title': '근처 스포츠 자원 지도',
  'Marker.Title': '지도 마커',
  'Popup.Close': '닫기',
  'AttributionControl.ToggleAttribution': '저작자 표시 열기',
  'AttributionControl.MapFeedback': '지도 피드백',
  'NavigationControl.ZoomIn': '확대',
  'NavigationControl.ZoomOut': '축소',
  'NavigationControl.ResetBearing': '북쪽으로 회전 초기화',
  'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl + 스크롤로 지도를 확대·축소하세요',
  'CooperativeGesturesHandler.MacHelpText': '⌘ + 스크롤로 지도를 확대·축소하세요',
  'CooperativeGesturesHandler.MobileHelpText': '두 손가락으로 지도를 움직이세요',
}

// 마커 색: 이용권 가맹=파랑, 공공/대안=초록, 장애인=보라 (색+텍스트 병기).
type Kind = 'voucher' | 'dvoucher' | 'public' | 'person'

interface MapPoint {
  id: string
  name: string
  lat: number
  lon: number
  kind: Kind
  dist_km?: number | null
  detail?: string
  approx?: boolean // 좌표 정직성: 구 중심 폴백(centroid)이면 거리 대신 근사 안내
}

type MarkerHit = { marker: Marker; el: HTMLElement; point: MapPoint }

function kindLabel(kind: Kind): string {
  switch (kind) {
    case 'voucher':
      return '이용권 가맹'
    case 'dvoucher':
      return '장애인 가맹'
    case 'public':
      return '공공·대안'
    case 'person':
      return '내 위치'
  }
}

// 마커 접근성 이름(대체텍스트) — 스크린리더/키보드 포커스용. 색만으로 의미를 전달하지 않는다.
function markerTitle(p: MapPoint): string {
  if (p.kind === 'person') return '내 위치'
  const where = p.approx ? '위치 근사(구 중심)' : p.dist_km != null ? `${p.dist_km.toFixed(1)}km` : ''
  return [p.name, kindLabel(p.kind), where].filter(Boolean).join(' · ')
}

// 마커 DOM — Leaflet divIcon 과 같은 .marker-pin(원+흰 링), 색은 CSS 변수 그대로.
// role/tabindex 는 Marker 가 채워 준다(div + aria-label → role="button", 팝업 있으면 tabindex=0).
function markerElement(p: MapPoint): HTMLElement {
  const el = document.createElement('div')
  el.className = 'marker-pin'
  el.dataset.kind = p.kind
  el.dataset.testid = 'map-marker'
  const label = markerTitle(p)
  el.title = label
  el.setAttribute('aria-label', label)
  if (p.kind === 'person') {
    el.style.background = 'var(--color-ink)'
    el.style.width = '16px'
    el.style.height = '16px'
  } else {
    el.style.background =
      p.kind === 'voucher'
        ? markerColor('voucher')
        : p.kind === 'dvoucher'
          ? markerColor('disability')
          : markerColor('public')
  }
  return el
}

// 범위 결과 마커: 같은 종류·같은 좌표 n곳을 한 마커로. n>1 이면 숫자 배지(잉크·종이).
function areaMarkerElement(group: MapPoint[]): HTMLElement {
  const first = group[0]
  const el = markerElement(first)
  const n = group.length
  el.dataset.area = 'true'
  el.dataset.count = String(n)
  if (n > 1) {
    const label = `같은 자리 ${n}곳 · ${kindLabel(first.kind)} · ${group.map((g) => g.name).join(', ')}`
    el.title = label
    el.setAttribute('aria-label', label)
    const badge = document.createElement('span')
    badge.className = 'marker-count'
    badge.setAttribute('aria-hidden', 'true')
    badge.textContent = String(n)
    el.appendChild(badge)
  }
  return el
}

// 팝업 내용 — 문자열 조립(innerHTML) 대신 DOM 으로 만든다(시설명 그대로 넣어도 안전).
function popupContent(p: MapPoint): HTMLElement {
  const root = document.createElement('div')
  root.className = 'map-popup'
  const name = document.createElement('b')
  name.textContent = p.name
  root.appendChild(name)
  if (p.detail) {
    const d = document.createElement('div')
    d.textContent = p.detail
    root.appendChild(d)
  }
  if (p.approx) {
    const warn = document.createElement('div')
    warn.className = 'map-popup-approx'
    warn.textContent = '위치 근사(구 중심)'
    root.appendChild(warn)
  } else if (p.dist_km != null) {
    const dist = document.createElement('div')
    dist.textContent = km(p.dist_km)
    root.appendChild(dist)
  }
  return root
}

function groupPopupContent(group: MapPoint[]): HTMLElement {
  const root = document.createElement('div')
  root.className = 'map-popup'
  const title = document.createElement('b')
  title.textContent = `같은 자리 ${group.length}곳`
  root.appendChild(title)
  const ul = document.createElement('ul')
  ul.className = 'map-popup-list'
  for (const g of group) {
    const li = document.createElement('li')
    li.textContent = g.name
    ul.appendChild(li)
  }
  root.appendChild(ul)
  return root
}

function snapCamera(map: MapLibreMap): CameraSnap {
  const c = map.getCenter()
  return { lat: c.lat, lng: c.lng, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
}

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

// "이 시설을 지도에서 보여 달라"는 요청. 같은 시설을 다시 눌러도 seq 가 오르면 다시 날아간다
// (streamFocus·panelFocus 와 같은 형태 — 상태가 아니라 요청 횟수를 센다).
export interface MapLocate {
  id: string
  seq: number
}

// 범위 검색 상태(패널이 소유). reqId 는 요청마다 바뀐다 — 로딩 중에 새 요청이 나가도 알아챈다.
export interface NearbyMapArea {
  active: boolean
  loading: boolean
  shownBounds: AreaBounds | null
  points: AreaMapPoint[] | null
  reqId?: number
}

const IDLE_AREA: NearbyMapArea = { active: false, loading: false, shownBounds: null, points: null }

// 지목 확대 배율. fitBounds 의 maxZoom(15)보다 한 단계 안쪽 = "이 시설 한 곳"이 읽히는 거리.
const LOCATE_ZOOM = 16

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface ViewState {
  bounds: AreaBounds
  bearing: number
  pitch: number
}

export function NearbyMap({
  personLoc,
  nearby,
  locate,
  extraPoints,
  area = IDLE_AREA,
  onAreaSearch,
  onViewBounds,
}: {
  personLoc: LatLon
  nearby: Nearby
  // 시설 목록에서 이름을 누르면 여기로 온다(패널이 지도 탭으로 바뀐 뒤).
  locate?: MapLocate | null
  // 동·도로명·시설명 검색 결과 중 실좌표 행(근사 행은 오지 않는다). 목록에서 눌러 지목할 수 있게 얹는다.
  extraPoints?: SearchMapPoint[]
  area?: NearbyMapArea
  // "이 지역에서 다시 찾기" — 누른 순간의 지도 범위(6자리). via 는 포커스 이동 방식(포인터/키보드)에 쓴다.
  onAreaSearch?: (b: AreaBounds, via: 'pointer' | 'keyboard') => void
  // 이동이 끝날 때마다 보이는 범위(패널의 "이 지도 범위 / 찾았던 범위" 제목)
  onViewBounds?: (b: AreaBounds) => void
}) {
  const points = useMemo<MapPoint[]>(() => {
    const pts: MapPoint[] = [
      { id: 'me', name: '내 위치', lat: personLoc.lat, lon: personLoc.lon, kind: 'person' },
    ]
    for (const v of nearby.voucher_facilities) {
      pts.push({
        id: v.id,
        name: v.name,
        lat: v.lat,
        lon: v.lon,
        kind: v.source === 'dvoucher' ? 'dvoucher' : 'voucher',
        dist_km: v.dist_km,
        detail: v.sports.join(' · '),
        approx: v.coord_source === 'centroid',
      })
    }
    for (const a of nearby.alternatives) {
      pts.push({
        id: a.id,
        name: a.name,
        lat: a.lat,
        lon: a.lon,
        kind: 'public',
        dist_km: a.dist_km,
        detail: a.sports.join(' · '),
        approx: a.coord_source === 'centroid',
      })
    }
    const seen = new Set(pts.map((p) => p.id))
    for (const e of extraPoints ?? []) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      pts.push({ ...e, approx: false })
    }
    return pts
  }, [personLoc, nearby, extraPoints])

  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  // 지목(flyTo + 팝업 + 강조)을 위해 id 로 마커를 되찾는 색인. 마커가 다시 그려질 때 함께 갱신된다.
  const byIdRef = useRef(new Map<string, MarkerHit>())
  // 범위 결과 마커(별도 묶음) — 묶음 마커 하나가 여러 id 를 가진다.
  const areaMarkersRef = useRef<Marker[]>([])
  const areaByIdRef = useRef(new Map<string, MarkerHit>())
  // 지금 강조 중인 마커 — 다음 지목에서 표식을 걷어내야 하므로 들고 있는다.
  const focusedRef = useRef<HTMLElement | null>(null)
  const locateDone = useRef(0)
  // fitBounds 는 "이번 결과에 대해 한 번"만 — 숨김 탭(0px)에서는 미뤘다가 보일 때 실행한다.
  const fitRef = useRef<{ points: MapPoint[]; done: boolean }>({ points: [], done: false })
  const pointsRef = useRef<MapPoint[]>(points)
  // WebGL 이 없거나(구형 기기·정책 차단) 지도 초기화가 실패해도 앱은 살아 있어야 한다.
  const [failed, setFailed] = useState(false)
  fitRef.current.points = points
  pointsRef.current = points

  // ── 범위 모드·이동 판정 상태 ────────────────────────────────────────────
  const areaActiveRef = useRef(false)
  // 범위 결과 마커를 보이는 중인가(area.points != null). 범위 모드여도 결과가 아직 없으면(첫 범위 검색이 로딩 중이거나
  // 실패해 prev 가 없다) 지도에는 기존 마커가 떠 있다.
  const areaShownRef = useRef(false)
  // 범위 모드 중에 기존 결과가 바뀌었다 — 되돌아갈 때 다시 맞춘다(기록용).
  const pendingRefitRef = useRef(false)
  // 앱이 카메라 메서드/resize() 를 부르는 동안만 true(try/finally). movestart 가 동기로 오므로 이걸로 가른다.
  const progRef = useRef(false)
  const resizeRef = useRef(false)
  const lastModWheelAt = useRef<number | null>(null)
  const pendingClassRef = useRef<MoveClass | null>(null)
  // movestart 때의 카메라 — moveend 에서 실제로 움직였는지 비교한다.
  const startCamRef = useRef<CameraSnap | null>(null)
  const onViewBoundsRef = useRef(onViewBounds)
  useEffect(() => {
    onViewBoundsRef.current = onViewBounds
  }, [onViewBounds])

  const [lastMove, setLastMove] = useState<LastMove>('none')
  const [userMoveSeq, setUserMoveSeq] = useState(0)
  const userMoveSeqRef = useRef(0)
  const [view, setView] = useState<ViewState | null>(null)

  // 요청 seq: 요청이 시작되는 순간의 userMoveSeq 를 기록하고, 끝나는 순간 settleAfterRequest.
  // (렌더 중 파생 상태 갱신 — 첫 로딩 렌더부터 requestPending 이 맞게 나온다.)
  const loadKey = area.loading ? (area.reqId ?? 0) : null
  const [prevLoadKey, setPrevLoadKey] = useState<number | null>(null)
  const [reqSeq, setReqSeq] = useState(0)
  if (loadKey !== prevLoadKey) {
    setPrevLoadKey(loadKey)
    if (loadKey != null) setReqSeq(userMoveSeq)
    else setLastMove(settleAfterRequest(lastMove, reqSeq, userMoveSeq))
  }
  // 범위 모드가 끝나는 커밋(원래 결과로 K4 · 새 판정 K5 · 다른 시군구 찾기 K6)은 이미 **앱의 이동**이다 — 곧 기존
  // 마커를 되올리고 화면을 다시 맞춘다(§6.5). 다시 맞춤(fitBounds)은 그 커밋의 effect 에서 동기로 끝나지만, 그
  // movestart 의 setLastMove('program') 은 페인트 뒤에야 렌더된다. 그래서 끌어 둔 lastMove='user' 가 남은 이 커밋이
  // 이미 원래 화면으로 돌아간 지도 위에 낡은 "이 지역에서 다시 찾기"를 한 프레임 그렸고, 그 프레임에 누르면 방금
  // 되돌린 범위로 검색이 시작됐다. 렌더 중에 파생 상태로 먼저 거둔다(요청 seq 정산 **뒤** — 같은 렌더의 정산이
  // 'user' 로 되돌리지 않게. 렌더 중 setState 는 호출 순서대로 적용된다).
  const [prevAreaActiveState, setPrevAreaActiveState] = useState(area.active)
  if (area.active !== prevAreaActiveState) {
    setPrevAreaActiveState(area.active)
    if (!area.active) setLastMove('program')
  }
  const requestPending = area.loading && userMoveSeq === reqSeq
  const gate: AreaGate = view ? areaGate(view.bounds, { bearing: view.bearing, pitch: view.pitch }) : 'invalid'
  const sameAsShown = sameBounds(view?.bounds, area.shownBounds)
  // 지목 요청이 왔고 아직 처리(flyTo 시작)하지 않았다 — 이 렌더에서 이미 앱의 이동으로 친다. 목록 탭에서
  // 지목하면 지도 탭이 보이는 바로 그 커밋에 낡은 버튼이 한 프레임이라도 그려지지 않게 한다.
  const [locateHandled, setLocateHandled] = useState(0)
  const locatePending = locate != null && locate.seq !== locateHandled
  const control: AreaControl = areaControlState({
    mapFailed: failed,
    requestPending,
    lastMove: locatePending ? 'program' : lastMove,
    gate,
    sameAsShown,
  })

  function programMove(fn: () => void) {
    progRef.current = true
    try {
      fn()
    } finally {
      progRef.current = false
    }
  }

  function resizeMap(map: MapLibreMap) {
    resizeRef.current = true
    try {
      map.resize()
    } finally {
      resizeRef.current = false
    }
  }

  function readView(map: MapLibreMap): ViewState | null {
    const el = boxRef.current
    if (!el || el.clientWidth < 2 || el.clientHeight < 2) return null
    const bb = map.getBounds()
    return {
      bounds: toAreaBounds(bb.getSouthWest(), bb.getNorthEast()),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    }
  }

  // 보이는 순간(0px → 실크기) 한 번만 전체 마커가 들어오게 맞춘다.
  function fitToPoints() {
    // 범위 결과를 보이는 동안(로딩·오류 포함)은 화면을 옮기지 않는다 — 사용자가 고른 범위다.
    if (areaActiveRef.current) return
    const map = mapRef.current
    const el = boxRef.current
    if (!map || !el) return
    const { points: pts, done } = fitRef.current
    if (done || pts.length === 0) return
    if (el.clientWidth < 2 || el.clientHeight < 2) {
      // 접힌 시트·숨김 탭: 맞춤을 미룬다. 미뤄 둔 맞춤은 지도가 보이는 순간 RO 콜백에서 실행되는 **앱의 이동**이다 —
      // 지금 앱의 이동으로 쳐 둔다(지목의 locatePending 과 같은 가드). 안 그러면 탭이 돌아오는 커밋은 사용자가 전에
      // 끌어 둔 lastMove='user' 로 그려져, 곧 옮겨질 옛 화면 위에 낡은 버튼이 한 프레임 페인트된다(RO 콜백의
      // setLastMove 는 그 페인트 뒤에야 렌더된다).
      setLastMove('program')
      return
    }
    const bounds = new LngLatBounds()
    for (const p of pts) bounds.extend([p.lon, p.lat])
    el.removeAttribute('data-map-ready') // 카메라를 옮기므로 렌더 완료 표식은 다시 꺼진다
    programMove(() => map.fitBounds(bounds, { padding: 36, maxZoom: 15, animate: false }))
    fitRef.current.done = true
  }

  function clearFocus() {
    focusedRef.current = null
  }

  function drawBase(map: MapLibreMap) {
    for (const m of markersRef.current) m.remove()
    byIdRef.current = new Map()
    clearFocus()
    markersRef.current = pointsRef.current.map((p) => {
      const el = markerElement(p)
      const marker = new Marker({ element: el, anchor: 'center' })
        .setLngLat([p.lon, p.lat])
        .setPopup(new Popup({ offset: 14, maxWidth: '240px' }).setDOMContent(popupContent(p)))
        .addTo(map)
      byIdRef.current.set(p.id, { marker, el, point: p })
      return marker
    })
  }

  function hideBase() {
    for (const m of markersRef.current) m.remove()
    markersRef.current = []
    byIdRef.current = new Map()
    clearFocus()
  }

  function clearArea() {
    for (const m of areaMarkersRef.current) m.remove()
    areaMarkersRef.current = []
    areaByIdRef.current = new Map()
    clearFocus()
  }

  function drawArea(map: MapLibreMap, pts: AreaMapPoint[]) {
    clearArea()
    const groups = new Map<string, MapPoint[]>()
    for (const p of pts) {
      const key = `${p.kind}|${p.lat}|${p.lon}`
      const mp: MapPoint = { id: p.id, name: p.name, lat: p.lat, lon: p.lon, kind: p.kind, detail: p.detail }
      const g = groups.get(key)
      if (g) g.push(mp)
      else groups.set(key, [mp])
    }
    for (const group of groups.values()) {
      const first = group[0]
      const el = areaMarkerElement(group)
      const content = group.length === 1 ? popupContent(first) : groupPopupContent(group)
      const marker = new Marker({ element: el, anchor: 'center' })
        .setLngLat([first.lon, first.lat])
        .setPopup(new Popup({ offset: 14, maxWidth: '240px' }).setDOMContent(content))
        .addTo(map)
      areaMarkersRef.current.push(marker)
      for (const g of group) areaByIdRef.current.set(g.id, { marker, el, point: first })
    }
  }

  // ── 지도 인스턴스: 마운트 1회 생성(재마운트 금지) ───────────────────────
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    let map: MapLibreMap
    try {
      map = new MapLibreMap({
        container: el,
        style: isDarkTheme() ? STYLE_DARK : STYLE_LIGHT,
        center: [personLoc.lon, personLoc.lat],
        zoom: 13,
        attributionControl: false, // 아래에서 직접(저작자표시 문구 고정)
        // 모바일 한 손가락 팬은 페이지 스크롤로 넘긴다 + 휠 줌은 Ctrl 동반일 때만.
        cooperativeGestures: true,
        dragRotate: false,
        pitchWithRotate: false,
        // 범위 검색의 전제 = bearing 0 · pitch 0(getBounds() 가 보이는 화면과 같다).
        maxPitch: 0,
        // 박스 줌(Shift+드래그)은 originalEvent 없이 카메라를 옮겨 사용자 조작을 판정할 수 없다.
        boxZoom: false,
        // MapLibre 자체 ResizeObserver 는 끈다 — 아래 앱 RO 가 resize() 를 부르는 유일한 경로다
        // (자체 RO 는 50ms 뒤 비동기로 resize() 를 불러 가드 밖에서 movestart 가 난다).
        trackResize: false,
        maxZoom: 18,
        locale: LOCALE,
      })
    } catch {
      setFailed(true)
      return
    }
    map.touchZoomRotate.disableRotation()
    // Shift+←/→ 회전 · Shift+↑/↓ 기울이기를 막는다(bearing·pitch 0 유지).
    map.keyboard.disableRotation()
    map.addControl(
      new AttributionControl({ compact: true, customAttribution: ATTRIBUTION }),
      'bottom-right',
    )
    // compact 저작자표시는 기본이 '펼침'이라 좁은 카드(390px)에서 지도의 1/4을 덮는다.
    // 처음엔 ⓘ 로 접어 두고 눌러서 펼치게 한다(MapLibre 가 compact 클래스를 다시 붙이지 않는다).
    const attrib = el.querySelector('.maplibregl-ctrl-attrib')
    attrib?.classList.remove('maplibregl-compact-show')
    attrib?.removeAttribute('open')
    // 휠 줌을 막았으므로 확대·축소 버튼을 남긴다(키보드·터치 사용자 경로).
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    // 타일이 안 와도 앱은 죽지 않는다 — 시설 목록·카드로 정보가 완결된다(오프라인 내성).
    map.on('error', () => {})
    map.on('load', fitToPoints)
    // 렌더 완료 표식: 타일까지 다 그려진 프레임에서 켜진다(e2e 는 고정 sleep 대신 이걸 본다).
    map.on('idle', () => el.setAttribute('data-map-ready', 'true'))

    // 이동 판정: movestart 에서 분류하고, 짝이 되는 moveend 에서 반영한다.
    const writeCamera = () => {
      const c = map.getCenter()
      el.setAttribute('data-center', `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`)
      el.setAttribute('data-bearing', String(Math.round(map.getBearing()) || 0))
    }
    map.on('movestart', (e: { originalEvent?: Event }) => {
      // 이동 중 표식(e2e 통로): data-center 는 moveend 에서만 바뀌어 관성 이동 중에는 그대로다 — "300ms 동안
      // 그대로"만 보면 관성이 아직 끝나지 않았는데 멈췄다고 판정한다(waitMoveSettled). 관성 easeTo 는
      // 드래그의 movestart 를 이어 쓰고(noMoveStart) 끝에서 moveend 한 번을 낸다.
      el.setAttribute('data-moving', 'true')
      const cls = classifyMoveStart({
        resizing: resizeRef.current,
        programmatic: progRef.current,
        hasOriginalEvent: e.originalEvent != null,
        msSinceModWheel:
          lastModWheelAt.current == null ? null : performance.now() - lastModWheelAt.current,
      })
      pendingClassRef.current = cls
      startCamRef.current = snapCamera(map)
      // 앱의 이동은 시작하는 순간 버튼을 거둔다 — 비행 중에 누르면 사용자가 멈춰 본 적 없는 중간 화면으로
      // 검색되고, 버튼이 방금 연 팝업의 시설 이름·닫기(×)를 덮는다.
      if (cls === 'program') setLastMove('program')
    })
    map.on('moveend', () => {
      const cls = pendingClassRef.current ?? 'program'
      const start = startCamRef.current
      pendingClassRef.current = null
      startCamRef.current = null
      writeCamera()
      el.setAttribute('data-moving', 'false')
      if (cls === 'user') {
        // 카메라가 그대로면(막아 둔 Shift+화살표 회전·기울기, 줌 한계에서 누른 ±) 사용자 이동이 아니다 —
        // MapLibre 는 이것도 originalEvent 가 달린 변화 없는 easeTo 로 처리한다.
        if (cameraMoved(start, snapCamera(map))) {
          userMoveSeqRef.current += 1
          setUserMoveSeq(userMoveSeqRef.current)
          setLastMove('user')
        }
      } else if (cls === 'program') {
        setLastMove('program')
      }
      // resize: lastMove 는 그대로 — 컨테이너가 보일 때만 게이트·같은 범위를 다시 잰다.
      const v = readView(map)
      if (v) {
        setView(v)
        onViewBoundsRef.current?.(v.bounds)
      }
    })
    // ⌘/Ctrl+휠(과 트랙패드 핀치)은 originalEvent 없이 온다 — 직전 입력 시각으로 사용자 조작을 가린다.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) lastModWheelAt.current = performance.now()
    }
    el.addEventListener('wheel', onWheel, { capture: true, passive: true })
    writeCamera()
    el.setAttribute('data-moving', 'false')
    mapRef.current = map
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true })
      map.remove()
      mapRef.current = null
      markersRef.current = []
      areaMarkersRef.current = []
    }
    // 최초 중심만 personLoc 을 쓴다(이후 이동은 fitBounds 담당) — 의도적으로 1회.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 범위 결과 마커(기존 마커 효과보다 먼저 선언 — 같은 커밋에서 범위 모드 여부를 먼저 정한다) ──
  const prevAreaActive = useRef(false)
  useEffect(() => {
    areaActiveRef.current = area.active
    areaShownRef.current = area.active && area.points != null
    const was = prevAreaActive.current
    prevAreaActive.current = area.active
    const map = mapRef.current
    if (!map) return
    if (area.active) {
      // 로딩·오류 중이고 보일 결과가 아직 없으면 직전 화면을 그대로 둔다.
      if (area.points) {
        hideBase()
        drawArea(map, area.points)
      }
      return
    }
    if (was) {
      // 범위 모드 끝: 범위 마커를 지우고 기존 마커를 다시 올린 뒤 다시 맞춘다(프로그램 이동).
      clearArea()
      drawBase(map)
      pendingRefitRef.current = false
      fitRef.current = { points: pointsRef.current, done: false }
      fitToPoints()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area.active, area.points, failed])

  // ── 마커 + 화면 맞춤: 결과가 바뀔 때만 ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // 범위 모드 동안은 늦게 온 키워드 결과 등으로 지도가 튀지 않게 화면 맞춤을 하지 않는다(되돌아갈 때 반영).
    if (areaActiveRef.current) {
      pendingRefitRef.current = true
      // 범위 결과 마커를 보이는 중이면 기존 마커도 동결(범위 결과 > 키워드 결과 > 근처). 범위 결과가 아직 없으면
      // (첫 범위 검색이 로딩 중이거나 둘 다 실패해 prev 가 없다) 목록은 늦게 온 키워드 결과로 바뀐다 — 지도의 기존
      // 마커도 같게 다시 그린다(카메라는 그대로). 안 그러면 목록 행의 "지도에서 보기"가 지도에 없는 시설을 가리켜
      // 지도 탭으로만 바뀌고 확대·팝업·강조가 전혀 일어나지 않았다(지목 색인 byIdRef 에 그 시설이 없다).
      if (!areaShownRef.current) drawBase(map)
      return
    }
    drawBase(map)
    fitRef.current.done = false
    fitToPoints()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, failed])

  // ── 지목(시설 목록에서 시설 누르기) → 그 좌표로 확대 + 팝업 + 마커 강조 ──────────
  //   요청 1건당 정확히 한 번 움직인다(seq). 화면 이동은 flyTo — 어디서 어디로 갔는지가
  //   보여야 "이 시설이 저기구나"가 읽힌다. 모션 최소화 선호면 즉시 이동(jumpTo).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !locate || locate.seq === locateDone.current) return
    locateDone.current = locate.seq
    // 처리했다(찾지 못해도) — 렌더의 locatePending 을 푼다. 이 effect 는 [locate] 에만 반응해 다시 시도하지 않는다.
    setLocateHandled(locate.seq)
    // 범위 결과를 보이는 중이면 범위 마커에서 먼저 찾는다.
    const hit = areaByIdRef.current.get(locate.id) ?? byIdRef.current.get(locate.id)
    if (!hit) return
    // 목록 탭에서 넘어온 직후라 지도가 0px 였을 수 있다 — 캔버스 크기를 먼저 맞춘다.
    resizeMap(map)
    // 미뤄둔 fitBounds 가 나중에 실행되면 방금 맞춘 화면을 도로 넓혀 버린다 — 여기서 소진시킨다.
    fitRef.current.done = true
    boxRef.current?.removeAttribute('data-map-ready')
    const center: [number, number] = [hit.point.lon, hit.point.lat]
    programMove(() => {
      if (prefersReducedMotion()) map.jumpTo({ center, zoom: LOCATE_ZOOM })
      else map.flyTo({ center, zoom: LOCATE_ZOOM, duration: 700 })
    })
    // 강조는 색 체계를 건드리지 않는다 — 크기와 잉크 테두리로만 구분한다(색맹 안전).
    if (focusedRef.current && focusedRef.current !== hit.el) {
      focusedRef.current.classList.remove('marker-focused')
      focusedRef.current.removeAttribute('data-testid')
      focusedRef.current.dataset.testid = 'map-marker'
    }
    hit.el.classList.add('marker-focused')
    hit.el.dataset.testid = 'marker-focused'
    focusedRef.current = hit.el
    // 팝업 문구는 마커가 이미 갖고 있는 것을 그대로 쓴다(같은 사실을 두 벌로 적지 않는다).
    if (!hit.marker.getPopup()?.isOpen()) hit.marker.togglePopup()
  }, [locate])

  // 현재 배율을 DOM 으로 내보낸다(e2e 가 map 인스턴스에 손대지 않고 확대를 확인하는 통로).
  useEffect(() => {
    const map = mapRef.current
    const el = boxRef.current
    if (!map || !el) return
    const write = () => el.setAttribute('data-zoom', map.getZoom().toFixed(2))
    write()
    map.on('zoom', write)
    map.on('moveend', write)
    return () => {
      map.off('zoom', write)
      map.off('moveend', write)
    }
  }, [failed])

  // ── 컨테이너 크기 변화(탭 전환·시트 접힘/펼침·회전) → resize + 미뤄둔 fit ──
  //   trackResize:false 이므로 resize() 는 여기서만(그리고 지목 직전) 부른다 — 가드 안에서.
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const map = mapRef.current
      if (!map) return
      resizeMap(map)
      fitToPoints()
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 테마 전환(.dark 토글) → 스타일 교체. 마커는 DOM 오버레이라 그대로 살아남는다. ──
  useEffect(() => {
    const html = document.documentElement
    let dark = isDarkTheme()
    const mo = new MutationObserver(() => {
      const next = isDarkTheme()
      if (next === dark) return
      dark = next
      // 스타일을 통째로 갈아끼우므로 렌더 완료 표식을 내렸다가 새 스타일의 'idle' 에서 다시 켠다.
      boxRef.current?.removeAttribute('data-map-ready')
      mapRef.current?.setStyle(next ? STYLE_DARK : STYLE_LIGHT)
    })
    mo.observe(html, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])

  // ── 오버레이 낭독: 상태가 바뀔 때만. 같은 문구가 연속되면 비웠다가 다음 프레임에 채운다. ──
  const [live, setLive] = useState('')
  const liveRef = useRef('')
  const prevControl = useRef<AreaControl>('hidden')
  useEffect(() => {
    if (control === prevControl.current) return
    prevControl.current = control
    const msg =
      control === 'button'
        ? AREA_TEXT.liveButton
        : control === 'zoom_in'
          ? AREA_TEXT.liveZoom
          : control === 'outside'
            ? AREA_TEXT.liveOutside
            : control === 'loading'
              ? AREA_TEXT.liveLoading
              : null
    if (!msg) {
      // 숨김(요청 완료·되돌리기·지목·새 판정)이면 비운다 — 끝난 로딩과 없는 버튼을 가상 커서가 지금 상태처럼
      // 읽지 않게. 공손(polite) 영역을 비우는 것은 새 낭독을 만들지 않는다.
      liveRef.current = ''
      setLive('')
      return
    }
    if (msg === liveRef.current) {
      setLive('')
      const raf = requestAnimationFrame(() => setLive(msg))
      return () => cancelAnimationFrame(raf)
    }
    liveRef.current = msg
    setLive(msg)
  }, [control])

  function onAreaButton(e: MouseEvent<HTMLButtonElement>) {
    if (control === 'loading') return // aria-disabled — 포커스는 그대로 두고 클릭만 무시
    const map = mapRef.current
    if (!map) return
    // 앱이 카메라를 옮기는 중(비행)이면 누르지 않은 것으로 — 버튼은 시작 순간 거두지만 같은 프레임의 클릭까지 막는다.
    if (pendingClassRef.current === 'program') return
    // 누른 순간의 범위로 게이트를 다시 잰다(관성 이동 끝자락 등). ok 가 아니면 안내만 바뀐다.
    const v = readView(map)
    if (!v) return
    setView(v)
    onViewBoundsRef.current?.(v.bounds)
    if (areaGate(v.bounds, { bearing: v.bearing, pitch: v.pitch }) !== 'ok') return
    onAreaSearch?.(v.bounds, e.detail === 0 ? 'keyboard' : 'pointer')
  }

  const showButton = control === 'button' || control === 'loading'
  return (
    <div className="overflow-hidden rounded-[3px] border border-rule dark:border-rule-dark">
      <div className="relative">
        {/* 오버레이는 지도(boxRef) **앞** 형제 — 캔버스에서 Shift+Tab 한 번에 버튼으로 간다.
            MapLibre 가 소유하는 boxRef 안에는 React 자식을 넣지 않는다. 하단은 저작자표시 자리라 위 가운데.
            가운데 맞춤은 inset-x-12(좌우 48px = ± 버튼 자리) — left-1/2 + translate 는 절대 배치 상자가
            지도 폭의 절반으로 줄어 짧은 안내도 단어 중간에서 접힌다.
            쌓임 순서: 마커(격리된 캔버스 컨테이너 안) < 오버레이(z-1, 지도 앞 형제) < 팝업(z-1, 지도 안 — 문서 순서가
            뒤라 위) < MapLibre 컨트롤(z-2). 팝업이 오버레이 **위**여야 한다 — 팝업을 연 채 지도를 조금 끌면 버튼이 다시 떠서
            팝업의 시설 이름·닫기(×)를 덮고, ×를 누르면 팝업이 닫히는 대신 범위 검색이 실행됐다(index.css). */}
        {!failed && (
          <div
            data-testid="area-search-overlay"
            className="pointer-events-none absolute inset-x-12 top-2.5 z-[1] flex justify-center"
          >
            {showButton && (
              <button
                type="button"
                data-testid="area-search-button"
                aria-disabled={control === 'loading' ? 'true' : undefined}
                aria-busy={control === 'loading' ? 'true' : undefined}
                onClick={onAreaButton}
                className="pointer-events-auto min-h-11 max-w-full rounded-[3px] border border-paper bg-ink px-3.5 text-center font-serif text-[14px] leading-[1.35] font-extrabold break-keep text-paper hover:opacity-90 focus-visible:ring-2 focus-visible:ring-paper aria-disabled:cursor-progress aria-disabled:opacity-80 dark:border-paper-dark dark:bg-ink-dark dark:text-paper-dark dark:focus-visible:ring-paper-dark"
              >
                {control === 'loading' ? AREA_TEXT.buttonLoading : AREA_TEXT.button}
              </button>
            )}
            {control === 'zoom_in' && (
              <p
                data-testid="area-search-zoom-hint"
                className="pointer-events-none max-w-full rounded-[3px] border border-rule bg-paper px-3 py-2 text-center text-[13px] break-keep text-ink dark:border-rule-dark dark:bg-paper-dark dark:text-ink-dark"
              >
                {AREA_TEXT.zoomHint}
              </p>
            )}
            {control === 'outside' && (
              <p
                data-testid="area-search-outside"
                className="pointer-events-none max-w-full rounded-[3px] border border-rule bg-paper px-3 py-2 text-center text-[13px] break-keep text-ink dark:border-rule-dark dark:bg-paper-dark dark:text-ink-dark"
              >
                {AREA_TEXT.outside}
              </p>
            )}
          </div>
        )}
        <div ref={boxRef} data-testid="nearby-map" className="relative h-64 w-full sm:h-80">
          {failed && (
            <p className="absolute inset-0 grid place-items-center px-4 text-center text-[12px] text-mute dark:text-mute-dark">
              이 기기에서는 지도를 표시할 수 없어요. 아래 시설 목록에서 같은 정보를 확인하실 수 있어요.
            </p>
          )}
        </div>
      </div>
      {/* 오버레이 상태 낭독 — 항상 마운트(지도 실패 상태에서도). 오버레이 컨테이너 밖. */}
      <p data-testid="area-search-live" role="status" aria-live="polite" className="sr-only">
        {live}
      </p>
      <MapLegend />
    </div>
  )
}

function MapLegend() {
  const items: { label: string; color: string }[] = [
    { label: '이용권 가맹', color: 'var(--color-marker-voucher)' },
    { label: '공공/대안', color: 'var(--color-marker-public)' },
    { label: '장애인 가맹', color: 'var(--color-marker-disability)' },
  ]
  return (
    <div
      data-testid="map-legend"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule bg-paper px-3 py-2 text-[12px] text-mute dark:border-rule-dark dark:bg-paper-dark dark:text-mute-dark"
    >
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="marker-pin inline-block" style={{ width: 12, height: 12, borderWidth: 2, background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

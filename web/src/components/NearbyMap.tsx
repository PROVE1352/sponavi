// 근처 자원 지도 — MapLibre GL + OpenFreeMap 벡터 타일(v1.8).
//   래스터(Leaflet+OSM 타일 서버) → 벡터(OpenFreeMap)로 교체. 키·등록 불필요이고
//   저작자표시(OSM/OpenMapTiles/OpenFreeMap)는 AttributionControl 이 소유한다(제거 금지).
//   react 래퍼 없이 useRef+useEffect 로 직접 제어한다 — 패널 상주 1인스턴스라
//   재마운트 없이 markers/fitBounds/resize 만 갱신하면 된다(ARCHITECTURE §11.4).
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
} from 'maplibre-gl'
import type { LatLon, Nearby } from '../types'
import type { SearchMapPoint } from '../types_search'
import { km, markerColor } from '../lib/format'

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

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

// "이 시설을 지도에서 보여 달라"는 요청. 같은 시설을 다시 눌러도 seq 가 오르면 다시 날아간다
// (streamFocus·panelFocus 와 같은 형태 — 상태가 아니라 요청 횟수를 센다).
export interface MapLocate {
  id: string
  seq: number
}

// 지목 확대 배율. fitBounds 의 maxZoom(15)보다 한 단계 안쪽 = "이 시설 한 곳"이 읽히는 거리.
const LOCATE_ZOOM = 16

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function NearbyMap({
  personLoc,
  nearby,
  locate,
  extraPoints,
}: {
  personLoc: LatLon
  nearby: Nearby
  // 시설 목록에서 이름을 누르면 여기로 온다(패널이 지도 탭으로 바뀐 뒤).
  locate?: MapLocate | null
  // 동·도로명·시설명 검색 결과 중 실좌표 행(근사 행은 오지 않는다). 목록에서 눌러 지목할 수 있게 얹는다.
  extraPoints?: SearchMapPoint[]
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
  const byIdRef = useRef(new Map<string, { marker: Marker; el: HTMLElement; point: MapPoint }>())
  // 지금 강조 중인 마커 — 다음 지목에서 표식을 걷어내야 하므로 들고 있는다.
  const focusedRef = useRef<HTMLElement | null>(null)
  const locateDone = useRef(0)
  // fitBounds 는 "이번 결과에 대해 한 번"만 — 숨김 탭(0px)에서는 미뤘다가 보일 때 실행한다.
  const fitRef = useRef<{ points: MapPoint[]; done: boolean }>({ points: [], done: false })
  // WebGL 이 없거나(구형 기기·정책 차단) 지도 초기화가 실패해도 앱은 살아 있어야 한다.
  const [failed, setFailed] = useState(false)
  fitRef.current.points = points

  // 보이는 순간(0px → 실크기) 한 번만 전체 마커가 들어오게 맞춘다.
  function fitToPoints() {
    const map = mapRef.current
    const el = boxRef.current
    if (!map || !el) return
    const { points: pts, done } = fitRef.current
    if (done || pts.length === 0) return
    if (el.clientWidth < 2 || el.clientHeight < 2) return // 접힌 시트·숨김 탭
    const bounds = new LngLatBounds()
    for (const p of pts) bounds.extend([p.lon, p.lat])
    el.removeAttribute('data-map-ready') // 카메라를 옮기므로 렌더 완료 표식은 다시 꺼진다
    map.fitBounds(bounds, { padding: 36, maxZoom: 15, animate: false })
    fitRef.current.done = true
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
        maxZoom: 18,
        locale: LOCALE,
      })
    } catch {
      setFailed(true)
      return
    }
    map.touchZoomRotate.disableRotation()
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
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current = []
    }
    // 최초 중심만 personLoc 을 쓴다(이후 이동은 fitBounds 담당) — 의도적으로 1회.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 마커 + 화면 맞춤: 결과가 바뀔 때만 ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const m of markersRef.current) m.remove()
    byIdRef.current = new Map()
    focusedRef.current = null
    markersRef.current = points.map((p) => {
      const el = markerElement(p)
      const marker = new Marker({ element: el, anchor: 'center' })
        .setLngLat([p.lon, p.lat])
        .setPopup(new Popup({ offset: 14, maxWidth: '240px' }).setDOMContent(popupContent(p)))
        .addTo(map)
      byIdRef.current.set(p.id, { marker, el, point: p })
      return marker
    })
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
    const hit = byIdRef.current.get(locate.id)
    if (!hit) return
    locateDone.current = locate.seq
    // 목록 탭에서 넘어온 직후라 지도가 0px 였을 수 있다 — 캔버스 크기를 먼저 맞춘다.
    map.resize()
    // 미뤄둔 fitBounds 가 나중에 실행되면 방금 맞춘 화면을 도로 넓혀 버린다 — 여기서 소진시킨다.
    fitRef.current.done = true
    boxRef.current?.removeAttribute('data-map-ready')
    const center: [number, number] = [hit.point.lon, hit.point.lat]
    if (prefersReducedMotion()) map.jumpTo({ center, zoom: LOCATE_ZOOM })
    else map.flyTo({ center, zoom: LOCATE_ZOOM, duration: 700 })
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
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      mapRef.current?.resize()
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

  return (
    <div className="overflow-hidden rounded-[3px] border border-rule dark:border-rule-dark">
      <div ref={boxRef} data-testid="nearby-map" className="relative h-64 w-full sm:h-80">
        {failed && (
          <p className="absolute inset-0 grid place-items-center px-4 text-center text-[12px] text-mute dark:text-mute-dark">
            이 기기에서는 지도를 표시할 수 없어요. 아래 시설 목록에서 같은 정보를 확인하실 수 있어요.
          </p>
        )}
      </div>
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

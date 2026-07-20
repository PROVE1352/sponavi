import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import type { LatLon, Nearby } from '../types'
import { km, markerColor } from '../lib/format'

// 마커 색: 이용권 가맹=파랑, 공공/대안=초록, 장애인=보라 (색+텍스트 병기).
type Kind = 'voucher' | 'dvoucher' | 'public' | 'person'

interface MapPoint {
  id: string
  name: string
  lat: number
  lon: number
  kind: Kind
  dist_km?: number
  detail?: string
}

function pinIcon(kind: Kind): L.DivIcon {
  if (kind === 'person') {
    return L.divIcon({
      className: '',
      html: `<span class="marker-pin" style="background:var(--color-brand-600);width:16px;height:16px"></span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    })
  }
  const color = kind === 'voucher' ? markerColor('voucher') : kind === 'dvoucher' ? markerColor('disability') : markerColor('public')
  return L.divIcon({
    className: '',
    html: `<span class="marker-pin" style="background:${color}"></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  })
}

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]))
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 })
  }, [points, map])
  return null
}

export function NearbyMap({ personLoc, nearby }: { personLoc: LatLon; nearby: Nearby }) {
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
      })
    }
    for (const a of nearby.alternatives) {
      pts.push({
        id: a.id,
        name: a.name,
        lat: a.lat,
        lon: a.lon,
        kind: a.disability_support ? 'public' : 'public',
        dist_km: a.dist_km,
        detail: a.sports.join(' · '),
      })
    }
    return pts
  }, [personLoc, nearby])

  const center: [number, number] = [personLoc.lat, personLoc.lon]

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm dark:border-slate-800">
      <MapContainer
        center={center}
        zoom={14}
        scrollWheelZoom={false}
        style={{ height: '20rem', width: '100%' }}
        aria-label="근처 스포츠 자원 지도"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {points.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lon]} icon={pinIcon(p.kind)}>
            <Popup>
              <b>{p.name}</b>
              {p.detail && <div>{p.detail}</div>}
              {p.dist_km != null && <div>{km(p.dist_km)}</div>}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-white px-4 py-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="marker-pin inline-block" style={{ width: 12, height: 12, borderWidth: 2, background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

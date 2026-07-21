import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AlternativeFacility, Nearby, VoucherFacility } from '../types'
import type { AccessibilityMap, FacilityAccessibility } from '../types_accessibility'
import { accessibilitySourceLine } from '../types_accessibility'
import { getAccessibility } from '../api/client'
import { km, walkMinutes, won, wonPlain } from '../lib/format'
import { ApproxLocationBadge, Badge, CheckIcon, WarnIcon } from './ui'
import { AccessibilityFilter } from './AccessibilityFilter'

function matchesFilter(sports: string[], filter?: string[]): boolean {
  if (!filter || filter.length === 0) return true
  return sports.some((s) => filter.includes(s))
}

export function NearbyList({
  nearby,
  filterSports,
  onClearFilter,
}: {
  nearby: Nearby
  filterSports?: string[]
  onClearFilter?: () => void
}) {
  // FR-10: dvoucher(장애인 가맹) 시설의 접근성 보조 정보(별도 API, engine 무접촉).
  // 부분 실패 격리: 이 조회가 실패해도 시설 리스트는 그대로 뜨고, 인라인 안내 + 재시도만 노출한다.
  const [access, setAccess] = useState<AccessibilityMap>({})
  const [accessError, setAccessError] = useState(false)
  const [accessLoading, setAccessLoading] = useState(false)
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([])
  const loadToken = useRef(0)

  const dvoucherIds = useMemo(
    () =>
      nearby.voucher_facilities
        .filter((v) => v.source === 'dvoucher')
        .map((v) => v.id),
    [nearby],
  )
  const dvoucherKey = dvoucherIds.join(',')

  const loadAccess = useCallback((ids: string[]) => {
    if (ids.length === 0) {
      setAccess({})
      setAccessError(false)
      setAccessLoading(false)
      return
    }
    const token = ++loadToken.current
    setAccessLoading(true)
    setAccessError(false)
    getAccessibility(ids)
      .then((m) => {
        if (token !== loadToken.current) return
        setAccess(m)
        setAccessError(false)
      })
      .catch(() => {
        if (token !== loadToken.current) return
        setAccess({}) // 거짓 데이터로 채우지 않는다(정직 원칙) — 미상으로 남긴다
        setAccessError(true)
      })
      .finally(() => {
        if (token === loadToken.current) setAccessLoading(false)
      })
  }, [])

  useEffect(() => {
    setSelectedAmenities([]) // 새 결과마다 필터 초기화
    loadAccess(dvoucherIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dvoucherKey])

  const hasDvoucher = dvoucherIds.length > 0

  // 현재 결과에 실제 존재하는 편의시설 코드(있는 것만 강조)
  const availableAmenities = useMemo(() => {
    const s = new Set<string>()
    for (const id of dvoucherIds)
      for (const a of access[id]?.amenities ?? []) s.add(a.code)
    return s
  }, [access, dvoucherIds])

  const passesAmenity = (v: VoucherFacility): boolean => {
    if (v.source !== 'dvoucher' || selectedAmenities.length === 0) return true
    const a = access[v.id]
    if (!a) return false // 데이터 없으면 조건 확인 불가 → 제외(추정 금지 P-1)
    const codes = new Set(a.amenities.map((x) => x.code))
    return selectedAmenities.every((c) => codes.has(c))
  }

  const vouchers = nearby.voucher_facilities
    .filter((v) => matchesFilter(v.sports, filterSports))
    .filter(passesAmenity)
  const alts = nearby.alternatives.filter((a) => matchesFilter(a.sports, filterSports))
  const filterActive = Boolean(filterSports && filterSports.length > 0)
  const amenityActive = selectedAmenities.length > 0

  const checkedDate = Object.values(access).find((a) => a.checked)?.checked ?? null

  function toggleAmenity(code: string) {
    setSelectedAmenities((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    )
  }

  return (
    <section aria-label="근처 자원 목록" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">근처 자원</h2>
        {filterActive && (
          <div className="flex items-center gap-2 text-xs">
            <Badge tone="brand">운동 필터: {filterSports!.join(' · ')}</Badge>
            {onClearFilter && (
              <button
                type="button"
                onClick={onClearFilter}
                className="rounded-md px-2 py-1 font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                필터 해제
              </button>
            )}
          </div>
        )}
      </div>

      {/* FR-10: 편의시설 칩 필터 — 장애 있음(dvoucher 가맹) 결과에서만 노출 */}
      {hasDvoucher && (
        <AccessibilityFilter
          selected={selectedAmenities}
          onToggle={toggleAmenity}
          onClear={() => setSelectedAmenities([])}
          available={availableAmenities}
        />
      )}

      {/* 접근성 조회 로딩/실패 — 실패해도 아래 시설 리스트는 완전히 동작한다(부분 실패 격리) */}
      {hasDvoucher && accessLoading && (
        <p data-testid="accessibility-loading" className="text-xs text-slate-500 dark:text-slate-400">
          접근성 정보를 불러오는 중…
        </p>
      )}
      {hasDvoucher && accessError && !accessLoading && (
        <div
          role="status"
          data-testid="accessibility-error"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200"
        >
          <span className="inline-flex items-center gap-2">
            <WarnIcon className="h-4 w-4 shrink-0" />
            접근성 정보를 불러오지 못했습니다. 시설 목록은 정상 표시됩니다.
          </span>
          <button
            type="button"
            data-testid="accessibility-retry"
            onClick={() => loadAccess(dvoucherIds)}
            className="rounded-md px-2 py-1 text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-50"
          >
            다시 시도
          </button>
        </div>
      )}

      {vouchers.length > 0 && (
        <div data-testid="voucher-section">
          <h3 className="mb-2 text-sm font-semibold text-brand-700 dark:text-brand-100">이용권 가맹시설</h3>
          <ul className="space-y-2">
            {vouchers.map((v) => (
              <VoucherRow key={v.id} v={v} accessibility={access[v.id]} accessError={accessError} />
            ))}
          </ul>
        </div>
      )}

      {/* dvoucher 시설이 있는데 편의시설 필터로 전부 걸러진 경우(P-1: 없음을 숨기지 않음) */}
      {hasDvoucher &&
        amenityActive &&
        vouchers.filter((v) => v.source === 'dvoucher').length === 0 && (
          <p
            data-testid="amenity-empty"
            className="rounded-xl bg-violet-50 p-4 text-sm text-violet-800 dark:bg-violet-500/10 dark:text-violet-200"
          >
            선택한 편의시설을 모두 갖춘 장애인 가맹시설이 근처에 없습니다. 칩을 해제해 보세요.
          </p>
        )}

      {/* FR-10 AC3: 접근성 블록 하단 고정 출처 */}
      {hasDvoucher && (
        <p
          data-testid="accessibility-source"
          className="text-xs text-slate-600 dark:text-slate-400"
        >
          {accessibilitySourceLine(checkedDate)} · 공단 웹서비스 공개 조회(보조)
        </p>
      )}

      {alts.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">공공·대안 시설</h3>
          <ul className="space-y-2">
            {alts.map((a) => (
              <AltRow key={a.id} a={a} />
            ))}
          </ul>
        </div>
      )}

      {vouchers.length === 0 && alts.length === 0 && !amenityActive && (
        <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
          {filterActive
            ? '선택한 운동에 맞는 근처 시설이 없습니다. 필터를 해제해 보세요.'
            : '표시할 근처 자원이 없습니다.'}
        </p>
      )}
    </section>
  )
}

function DistTag({ dist }: { dist: number }) {
  return (
    <span className="text-xs text-slate-600 dark:text-slate-400">
      {km(dist)} · 도보 약 {walkMinutes(dist)}분
    </span>
  )
}

// 근사좌표(구 중심) 시설: 거리 대신 근사 안내. km 절대 표기 금지(카피 사전).
function ApproxTag() {
  return (
    <span className="text-xs text-slate-600 dark:text-slate-400">구 중심 근사 좌표 · 정확한 위치는 시설에 확인</span>
  )
}

// 실좌표면 거리, 근사좌표면 근사 안내를 렌더(둘 중 하나).
function LocationLine({ coordSource, dist }: { coordSource?: string; dist: number | null }) {
  if (coordSource === 'centroid') return <ApproxTag />
  if (dist != null) return <DistTag dist={dist} />
  return null
}

function DisabilityTag({ support }: { support: boolean | null }) {
  if (support !== true) return null
  return (
    <Badge tone="purple" icon={<CheckIcon className="w-3 h-3" />}>
      장애인 지원
    </Badge>
  )
}

// FR-10 AC2: 장애지원유형 목록 + 편의시설 태그. 데이터 없으면 "접근성 정보 없음"(미상 구분).
// 조회 자체가 실패했으면(error) "없음"과 구분해 "일시적으로 불러오지 못함"으로 정직하게 표기.
function AccessibilityTags({ data, error }: { data?: FacilityAccessibility; error?: boolean }) {
  if (!data) {
    if (error) {
      return (
        <p data-testid="access-error-inline" className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          접근성 정보를 일시적으로 불러오지 못했습니다
        </p>
      )
    }
    return (
      <p data-testid="access-none" className="mt-2 text-xs text-slate-600 dark:text-slate-400">
        접근성 정보 없음
      </p>
    )
  }
  const empty = data.types.length === 0 && data.amenities.length === 0
  return (
    <div data-testid="access-tags" className="mt-2 space-y-1.5">
      {data.types.length > 0 && (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-violet-700 dark:text-violet-300">지원: </span>
          {data.types.join(', ')}
        </p>
      )}
      {data.amenities.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {data.amenities.map((a) => (
            <li key={a.code}>
              <Badge tone="purple">{a.name}</Badge>
            </li>
          ))}
        </ul>
      )}
      {empty && <p className="text-xs text-slate-600 dark:text-slate-400">접근성 정보 없음</p>}
    </div>
  )
}

function VoucherRow({
  v,
  accessibility,
  accessError,
}: {
  v: VoucherFacility
  accessibility?: FacilityAccessibility
  accessError?: boolean
}) {
  const isDvoucher = v.source === 'dvoucher'
  return (
    <li
      data-testid={isDvoucher ? 'dvoucher-facility' : 'voucher-facility'}
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{v.name}</p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
            {v.sports.join(' · ')}
            {v.course_name ? ` · ${v.course_name}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={isDvoucher ? 'purple' : 'brand'}>{isDvoucher ? '장애인 가맹' : '이용권 가맹'}</Badge>
          {v.coord_source === 'centroid' && <ApproxLocationBadge />}
          <DisabilityTag support={v.disability_support} />
        </div>
      </div>
      {v.addr && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{v.addr}</p>}

      {/* 자부담 계산 */}
      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-800/60">
        <div>
          <dt className="text-[11px] text-slate-600 dark:text-slate-400">월 수강료</dt>
          <dd className="text-sm font-semibold text-slate-800 dark:text-slate-100">{won(v.fee_month)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-600 dark:text-slate-400">이용권 지원</dt>
          <dd className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">−{wonPlain(Math.min(v.subsidy, v.fee_month))}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-600 dark:text-slate-400">내 부담</dt>
          <dd className="text-sm font-bold text-brand-700 dark:text-brand-100">{won(v.copay)}</dd>
        </div>
      </dl>

      {/* FR-10: 장애인 가맹시설엔 접근성 태그(지원유형·편의시설) */}
      {isDvoucher && <AccessibilityTags data={accessibility} error={accessError} />}

      <div className="mt-2">
        <LocationLine coordSource={v.coord_source} dist={v.dist_km} />
      </div>
    </li>
  )
}

function AltRow({ a }: { a: AlternativeFacility }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{a.name}</p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
            {a.type} · {a.sports.join(' · ')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone="ok">공공·대안</Badge>
          {a.coord_source === 'centroid' && <ApproxLocationBadge />}
          <DisabilityTag support={a.disability_support} />
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{a.note}</p>
      <div className="mt-2 flex items-center justify-between">
        <LocationLine coordSource={a.coord_source} dist={a.dist_km} />
        {a.fee_month != null && (
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">월 {won(a.fee_month)}</span>
        )}
      </div>
    </li>
  )
}

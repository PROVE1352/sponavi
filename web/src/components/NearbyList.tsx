import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AlternativeFacility, Nearby, VoucherFacility } from '../types'
import type { AccessibilityMap, FacilityAccessibility } from '../types_accessibility'
import { accessibilitySourceLine } from '../types_accessibility'
import { getAccessibility } from '../api/client'
import { km, walkMinutes, won, wonPlain } from '../lib/format'
import type { AccessibilityView } from '../lib/accessibility'
import { LOAD_FAILED_TEXT, NO_INFO_TEXT, accessibilityView } from '../lib/accessibility'
import { matchesFilter } from '../lib/sports'
import { ApproxLocationBadge, Badge, CheckIcon, InfoIcon, WarnIcon } from './ui'
import { AccessibilityFilter } from './AccessibilityFilter'

// FR-10: dvoucher(장애인 가맹) 시설의 접근성 보조 정보(별도 API, engine 무접촉).
// 부분 실패 격리: 이 조회가 실패해도 시설 리스트는 그대로 뜨고, 인라인 안내 + 재시도만 노출한다.
// 챗 스트림의 시설 요약 카드도 같은 규약을 쓰도록 훅으로 분리해 export 한다(§11.4).
export function useFacilityAccessibility(ids: string[]): {
  access: AccessibilityMap
  loading: boolean
  error: boolean
  reload: () => void
} {
  const [access, setAccess] = useState<AccessibilityMap>({})
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const loadToken = useRef(0)
  const key = ids.join(',')

  const load = useCallback((list: string[]) => {
    if (list.length === 0) {
      setAccess({})
      setError(false)
      setLoading(false)
      return
    }
    const token = ++loadToken.current
    setLoading(true)
    setError(false)
    getAccessibility(list)
      .then((m) => {
        if (token !== loadToken.current) return
        setAccess(m)
        setError(false)
      })
      .catch(() => {
        if (token !== loadToken.current) return
        setAccess({}) // 거짓 데이터로 채우지 않는다(정직 원칙) — 미상으로 남긴다
        setError(true)
      })
      .finally(() => {
        if (token === loadToken.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    load(key === '' ? [] : key.split(','))
  }, [key, load])

  const reload = useCallback(() => load(key === '' ? [] : key.split(',')), [key, load])
  return { access, loading, error, reload }
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
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([])

  const dvoucherIds = useMemo(
    () =>
      nearby.voucher_facilities
        .filter((v) => v.source === 'dvoucher')
        .map((v) => v.id),
    [nearby],
  )
  const dvoucherKey = dvoucherIds.join(',')
  const {
    access,
    loading: accessLoading,
    error: accessError,
    reload: reloadAccess,
  } = useFacilityAccessibility(dvoucherIds)

  useEffect(() => {
    setSelectedAmenities([]) // 새 결과마다 필터 초기화
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
  // OV13: 수강료 미등록 행 수(요약 1줄의 근거).
  const feeMissing = vouchers.filter((v) => v.fee_month == null).length
  const altsFirst = nearby.primary === 'alternatives'

  const alternatives = alts.length > 0 && (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">공공·대안 시설</h3>
      <ul className="space-y-2">
        {alts.map((a) => (
          <AltRow key={a.id} a={a} />
        ))}
      </ul>
    </div>
  )

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
            onClick={reloadAccess}
            className="rounded-md px-2 py-1 text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-50"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 1A/OV3: 이용권 카드가 비적격이면(primary='alternatives') 대안이 먼저 온다 —
          못 쓰는 가맹시설을 1순위로 보여 주지 않는다. 순서 판단은 서버가 내린다(P-2). */}
      {altsFirst && alternatives}

      {vouchers.length > 0 && (
        <div data-testid="voucher-section">
          <h3 className="mb-2 text-sm font-semibold text-brand-700 dark:text-brand-100">이용권 가맹시설</h3>
          {/* OV13: 결측을 행마다 반복하지 않고 섹션 상단에서 한 번에 밝힌다 */}
          {feeMissing > 0 && (
            <p
              data-testid="voucher-fee-summary"
              className="mb-2 text-xs text-slate-600 dark:text-slate-400"
            >
              {/* 필터가 걸려 있으면 이 수는 "총"이 아니라 걸러진 뒤의 수다(C-4·P-1) */}
              {filterActive ? '이 종목' : '총'} {vouchers.length}곳 · 수강료 미등록 {feeMissing}곳 —
              시설 문의
            </p>
          )}
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

      {!altsFirst && alternatives}

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

// C-3(P-1): 지원 배지는 lib/accessibility 의 판정 1벌만 따른다.
//   유형 확인됨 → "✓ 장애인 지원"(확언) / 지원 불리언만 → "장애인 지원(유형 미상)"(확언 아님).
// 확언(✓)과 "접근성 정보 없음"이 한 카드에 같이 설 수 없는 이유가 여기 있다.
function DisabilityTag({ badge }: { badge: AccessibilityView['badge'] }) {
  if (!badge) return null
  const confirmed = badge.kind === 'confirmed'
  return (
    <span data-testid={confirmed ? 'support-confirmed' : 'support-unknown-types'}>
      <Badge
        tone="purple"
        icon={
          confirmed ? <CheckIcon className="w-3 h-3" /> : <InfoIcon className="w-3 h-3" />
        }
      >
        {badge.label}
      </Badge>
    </span>
  )
}

// FR-10 AC2: 장애지원유형 목록 + 편의시설 태그.
// "접근성 정보 없음"은 유형·편의시설이 모두 없고 지원 불리언도 참이 아닐 때만 나온다(C-3).
// 조회 자체가 실패했으면(error) "없음"과 구분해 "일시적으로 불러오지 못함"으로 정직하게 표기.
function AccessibilityTags({ view }: { view: AccessibilityView }) {
  if (view.note === 'error') {
    return (
      <p data-testid="access-error-inline" className="mt-2 text-xs text-amber-700 dark:text-amber-300">
        {LOAD_FAILED_TEXT}
      </p>
    )
  }
  if (view.note === 'none') {
    return (
      <p data-testid="access-none" className="mt-2 text-xs text-slate-600 dark:text-slate-400">
        {NO_INFO_TEXT}
      </p>
    )
  }
  if (view.types.length === 0 && view.amenities.length === 0) return null
  return (
    <div data-testid="access-tags" className="mt-2 space-y-1.5">
      {view.types.length > 0 && (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-violet-700 dark:text-violet-300">지원: </span>
          {view.types.join(', ')}
        </p>
      )}
      {view.amenities.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {view.amenities.map((a) => (
            <li key={a.code}>
              <Badge tone="purple">{a.name}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// 챗 스트림의 시설 요약 카드가 같은 행 컴포넌트를 재사용한다(§11.4 export 승격).
export function VoucherRow({
  v,
  accessibility,
  accessError,
}: {
  v: VoucherFacility
  accessibility?: FacilityAccessibility
  accessError?: boolean
}) {
  const isDvoucher = v.source === 'dvoucher'
  // 배지와 하단 태그를 같은 판정에서 뽑는다 — 두 곳이 각자 판단하면 모순이 생긴다(C-3).
  const view = accessibilityView(v.disability_support, accessibility, accessError)
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
          <DisabilityTag badge={view.badge} />
        </div>
      </div>
      {v.addr && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{v.addr}</p>}

      {/* 자부담 계산. CQ1A: 수강료가 결측이면 3셀을 만들지 않고 한 줄로 사실만 말한다
          — 0원·'무료'·'−0원' 으로 빈칸을 채우지 않는다(P-1). */}
      {v.fee_month == null ? (
        <p
          data-testid="fee-unknown"
          className="mt-3 rounded-lg bg-slate-50 p-3 text-center text-sm font-semibold text-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
        >
          수강료 미등록 · 시설 문의
        </p>
      ) : (
        <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-800/60">
          <div>
            <dt className="text-[11px] text-slate-600 dark:text-slate-400">월 수강료</dt>
            <dd className="text-sm font-semibold text-slate-800 dark:text-slate-100">{won(v.fee_month)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-600 dark:text-slate-400">이용권 지원</dt>
            {/* 1A: 비적격이면 서버가 subsidy=0 으로 내려보낸다 — '−0원' 대신 못 받는다고 적는다 */}
            {v.subsidy === 0 ? (
              <dd className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                지원 없음(예상 자격 ✗)
              </dd>
            ) : (
              <dd className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                −{wonPlain(Math.min(v.subsidy ?? 0, v.fee_month))}
              </dd>
            )}
          </div>
          <div>
            <dt className="text-[11px] text-slate-600 dark:text-slate-400">내 부담</dt>
            {/* 자부담 0 은 '무료'가 아니라 '0원'(수강료가 0인 것과 다른 사실) */}
            <dd className="text-sm font-bold text-brand-700 dark:text-brand-100">
              {v.copay == null ? won(null) : wonPlain(v.copay)}
            </dd>
          </div>
        </dl>
      )}

      {/* FR-10: 장애인 가맹시설엔 접근성 태그(지원유형·편의시설) */}
      {isDvoucher && <AccessibilityTags view={view} />}

      <div className="mt-2">
        <LocationLine coordSource={v.coord_source} dist={v.dist_km} />
      </div>
    </li>
  )
}

// OV6/FR-04 AC7: 시설 구분 라벨은 원천(faci_gb) 그대로 — 신고·등록 시설을 "공공체육시설"이라
// 부르지 않는다(실측 신고 107,407 · 공공 44,747 · 등록 634). 미마이그레이션(null)이면 중립어.
export function faciGbLabel(gb?: '공공' | '신고' | '등록' | null): {
  label: string
  tone: 'ok' | 'neutral'
} {
  switch (gb) {
    case '공공':
      return { label: '공공체육시설', tone: 'ok' }
    case '등록':
      return { label: '등록 체육시설', tone: 'neutral' }
    case '신고':
      return { label: '신고 체육시설', tone: 'neutral' }
    default:
      return { label: '체육시설', tone: 'neutral' }
  }
}

export function AltRow({ a }: { a: AlternativeFacility }) {
  const gb = faciGbLabel(a.faci_gb)
  // 공공·대안 풀에는 지원유형 조회 소스가 없다 — 원천이 준 불리언만 있으므로
  // "✓ 장애인 지원" 확언 대신 "장애인 지원(유형 미상)"으로 사실 그대로 적는다(C-3).
  const view = accessibilityView(a.disability_support)
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{a.name}</p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
            {/* 서버 type 은 대안 풀 전체가 "공공체육시설"이라 신고·등록 시설도 그렇게 불린다 —
                faci_gb 를 아는 행은 원천 라벨을 쓴다(FR-04 AC7). */}
            {a.faci_gb ? gb.label : a.type} · {a.sports.join(' · ')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={gb.tone}>{gb.label}</Badge>
          {a.coord_source === 'centroid' && <ApproxLocationBadge />}
          <DisabilityTag badge={view.badge} />
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AlternativeFacility, Nearby, VoucherFacility } from '../types'
import type { AccessibilityMap, FacilityAccessibility } from '../types_accessibility'
import { accessibilitySourceLine } from '../types_accessibility'
import { getAccessibility } from '../api/client'
import { km, walkMinutes, won, wonPlain } from '../lib/format'
import type { AccessibilityView } from '../lib/accessibility'
import { LOAD_FAILED_TEXT, NO_INFO_TEXT, accessibilityView } from '../lib/accessibility'
import { matchesFilter } from '../lib/sports'
import {
  ApproxLocationBadge,
  Badge,
  BTN_TEXT,
  CheckIcon,
  InfoIcon,
  ROW_RULE,
  TINT_BOX,
  WarnIcon,
} from './ui'
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

// 목록 섹션 제목: 명조 16px 800 + 우측 보조 12px mute (Main.dc "근처 공공·대안 강좌 3곳").
function ListHeading({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 pb-1">
      <h3 className="font-serif text-[16px] font-extrabold text-ink dark:text-ink-dark">{title}</h3>
      {aside && <span className="text-[12px] text-mute dark:text-mute-dark">{aside}</span>}
    </div>
  )
}

export function NearbyList({
  nearby,
  filterSports,
  onClearFilter,
  onLocate,
}: {
  nearby: Nearby
  filterSports?: string[]
  onClearFilter?: () => void
  // 시설 이름을 누르면 지도 탭으로 바꾸고 그 좌표로 확대한다(패널 전용).
  onLocate?: (id: string) => void
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
      <ListHeading title="공공·대안 시설" />
      <ul>
        {alts.map((a, i) => (
          <AltRow key={a.id} a={a} index={i + 1} onLocate={onLocate} />
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
    <section aria-label="근처 자원 목록" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-serif text-[18px] font-extrabold text-ink dark:text-ink-dark">근처 자원</h2>
        {filterActive && (
          <div className="flex items-center gap-2">
            <Badge>운동 필터: {filterSports!.join(' · ')}</Badge>
            {onClearFilter && (
              <button type="button" onClick={onClearFilter} className={BTN_TEXT}>
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
        <p
          data-testid="accessibility-loading"
          className="text-[12.5px] text-mute dark:text-mute-dark"
        >
          접근성 정보를 불러오는 중…
        </p>
      )}
      {hasDvoucher && accessError && !accessLoading && (
        <div
          role="status"
          data-testid="accessibility-error"
          className={`flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink dark:text-ink-dark ${TINT_BOX}`}
        >
          <span className="inline-flex items-start gap-2">
            <WarnIcon className="mt-0.5 h-4 w-4 shrink-0" />
            접근성 정보를 불러오지 못했습니다. 시설 목록은 정상 표시됩니다.
          </span>
          <button
            type="button"
            data-testid="accessibility-retry"
            onClick={reloadAccess}
            className={BTN_TEXT}
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
          <ListHeading title="이용권 가맹시설" />
          {/* OV13: 결측을 행마다 반복하지 않고 섹션 상단에서 한 번에 밝힌다 */}
          {feeMissing > 0 && (
            <p
              data-testid="voucher-fee-summary"
              className="pb-1 text-[12.5px] leading-[1.6] text-mute dark:text-mute-dark"
            >
              {/* 필터가 걸려 있으면 이 수는 "총"이 아니라 걸러진 뒤의 수다(C-4·P-1) */}
              {filterActive ? '이 종목' : '총'} {vouchers.length}곳 · 수강료 미등록 {feeMissing}곳 —
              시설 문의
            </p>
          )}
          <ul>
            {vouchers.map((v, i) => (
              <VoucherRow
                key={v.id}
                v={v}
                index={i + 1}
                accessibility={access[v.id]}
                accessError={accessError}
                onLocate={onLocate}
              />
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
            className={`text-[13px] leading-[1.6] text-ink dark:text-ink-dark ${TINT_BOX}`}
          >
            선택한 편의시설을 모두 갖춘 장애인 가맹시설이 근처에 없습니다. 칩을 해제해 보세요.
          </p>
        )}

      {/* FR-10 AC3: 접근성 블록 하단 고정 출처 */}
      {hasDvoucher && (
        <p
          data-testid="accessibility-source"
          className="text-[12px] leading-[1.6] text-mute dark:text-mute-dark"
        >
          {accessibilitySourceLine(checkedDate)} · 공단 웹서비스 공개 조회(보조)
        </p>
      )}

      {!altsFirst && alternatives}

      {vouchers.length === 0 && alts.length === 0 && !amenityActive && (
        <p className={`text-[13px] leading-[1.6] text-mute dark:text-mute-dark ${TINT_BOX}`}>
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
    <span className="whitespace-nowrap text-[13px] text-mute dark:text-mute-dark">
      {km(dist)} · 도보 약 {walkMinutes(dist)}분
    </span>
  )
}

// 근사좌표(구 중심) 시설: 거리 대신 근사 안내. km 절대 표기 금지(카피 사전).
function ApproxTag() {
  return (
    <span className="text-[12px] text-mute dark:text-mute-dark">
      구 중심 근사 좌표 · 정확한 위치는 시설에 확인
    </span>
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
        icon={confirmed ? <CheckIcon className="w-3 h-3" /> : <InfoIcon className="w-3 h-3" />}
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
      <p
        data-testid="access-error-inline"
        className="text-[12px] leading-[1.6] text-mute dark:text-mute-dark"
      >
        {LOAD_FAILED_TEXT}
      </p>
    )
  }
  if (view.note === 'none') {
    return (
      <p data-testid="access-none" className="text-[12px] leading-[1.6] text-mute dark:text-mute-dark">
        {NO_INFO_TEXT}
      </p>
    )
  }
  if (view.types.length === 0 && view.amenities.length === 0) return null
  return (
    <div data-testid="access-tags" className="flex flex-wrap gap-1">
      {view.types.length > 0 && <Badge>지원: {view.types.join(', ')}</Badge>}
      {view.amenities.map((a) => (
        <Badge key={a.code}>{a.name}</Badge>
      ))}
    </div>
  )
}

// 시설 행(종이 메모): 번호 열 + 이름/거리 한 줄 + 유형·종목 + 요금 + 태그.
// 행 사이는 1px rule — 카드 상자·그림자는 쓰지 않는다.
function RowShell({
  testId,
  index,
  name,
  right,
  facilityId,
  locatable,
  onLocate,
  children,
}: {
  testId: string
  index?: number
  name: string
  right: ReactNode
  // 지도에서 지목할 수 있는 행인가. 실좌표가 아닌 행(구 중심 폴백)은 확대해도 그 자리가 아니다.
  facilityId?: string
  locatable?: boolean
  onLocate?: (id: string) => void
  children: ReactNode
}) {
  const nameClass = 'min-w-0 break-keep text-left text-[16px] font-bold text-ink dark:text-ink-dark'
  // 행 전체가 아니라 **이름만** 버튼이다 — 행 안의 전화·출처 링크와 탭 순서가 엉키지 않는다.
  const canLocate = onLocate != null && locatable === true && facilityId != null
  return (
    <li data-testid={testId} className={`grid grid-cols-[22px_minmax(0,1fr)] gap-x-2 py-3 ${ROW_RULE}`}>
      <span aria-hidden="true" className="pt-0.5 text-[12px] text-mute dark:text-mute-dark">
        {index ?? ''}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          {canLocate ? (
            <button
              type="button"
              data-testid="facility-locate"
              aria-label={`${name} 지도에서 보기`}
              onClick={() => onLocate(facilityId)}
              className={`press ${nameClass} underline decoration-rule decoration-1 underline-offset-4 hover:decoration-ink dark:decoration-rule-dark dark:hover:decoration-ink-dark`}
            >
              {name}
            </button>
          ) : (
            <span className={nameClass}>{name}</span>
          )}
          {right && <span className="shrink-0">{right}</span>}
        </div>
        {/* P-1: 구 중심 폴백 좌표를 확대해 보여 주면 없는 정밀도를 지어내는 것이 된다. */}
        {onLocate != null && locatable === false && (
          <p
            data-testid="facility-locate-unavailable"
            className="text-[12px] text-mute dark:text-mute-dark"
          >
            위치 근사 — 지도 확대 불가
          </p>
        )}
        {children}
      </div>
    </li>
  )
}

// 챗 스트림의 시설 요약 카드가 같은 행 컴포넌트를 재사용한다(§11.4 export 승격).
export function VoucherRow({
  v,
  index,
  accessibility,
  accessError,
  onLocate,
}: {
  v: VoucherFacility
  index?: number
  accessibility?: FacilityAccessibility
  accessError?: boolean
  // 패널 목록에서만 넘어온다 — 스트림 요약 카드의 행은 지도를 소유하지 않는다.
  onLocate?: (id: string) => void
}) {
  const isDvoucher = v.source === 'dvoucher'
  // 배지와 하단 태그를 같은 판정에서 뽑는다 — 두 곳이 각자 판단하면 모순이 생긴다(C-3).
  const view = accessibilityView(v.disability_support, accessibility, accessError)
  return (
    <RowShell
      testId={isDvoucher ? 'dvoucher-facility' : 'voucher-facility'}
      index={index}
      name={v.name}
      facilityId={v.id}
      locatable={v.coord_source !== 'centroid'}
      onLocate={onLocate}
      right={
        v.coord_source === 'centroid' ? null : <LocationLine coordSource={v.coord_source} dist={v.dist_km} />
      }
    >
      <p className="text-[13px] leading-[1.6] text-mute dark:text-mute-dark">
        <span className="text-ink dark:text-ink-dark">
          {isDvoucher ? '장애인 가맹' : '이용권 가맹'}
        </span>
        {' · '}
        {v.sports.join(' · ')}
        {v.course_name ? ` · ${v.course_name}` : ''}
      </p>
      {v.addr && <p className="text-[12px] text-mute dark:text-mute-dark">{v.addr}</p>}
      {v.coord_source === 'centroid' && <LocationLine coordSource={v.coord_source} dist={v.dist_km} />}

      {/* 자부담 계산. CQ1A: 수강료가 결측이면 3셀을 만들지 않고 한 줄로 사실만 말한다
          — 0원·'무료'·'−0원' 으로 빈칸을 채우지 않는다(P-1). */}
      {v.fee_month == null ? (
        <p data-testid="fee-unknown" className="text-[12.5px] text-mute dark:text-mute-dark">
          수강료 미등록 · 시설 문의
        </p>
      ) : (
        <dl className={`grid grid-cols-3 gap-2 text-center ${TINT_BOX}`}>
          <div>
            <dt className="text-[11px] text-mute dark:text-mute-dark">월 수강료</dt>
            <dd className="text-[13px] font-bold text-ink dark:text-ink-dark">{won(v.fee_month)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-mute dark:text-mute-dark">이용권 지원</dt>
            {/* 1A: 비적격이면 서버가 subsidy=0 으로 내려보낸다 — '−0원' 대신 못 받는다고 적는다 */}
            {v.subsidy === 0 ? (
              <dd className="text-[13px] font-bold text-mute dark:text-mute-dark">
                지원 없음(예상 자격 ✗)
              </dd>
            ) : (
              <dd className="text-[13px] font-bold text-ok dark:text-ok-dark">
                −{wonPlain(Math.min(v.subsidy ?? 0, v.fee_month))}
              </dd>
            )}
          </div>
          <div>
            <dt className="text-[11px] text-mute dark:text-mute-dark">내 부담</dt>
            {/* 자부담 0 은 '무료'가 아니라 '0원'(수강료가 0인 것과 다른 사실) */}
            <dd className="text-[13px] font-bold text-ink dark:text-ink-dark">
              {v.copay == null ? won(null) : wonPlain(v.copay)}
            </dd>
          </div>
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-1">
        {v.coord_source === 'centroid' && <ApproxLocationBadge />}
        <DisabilityTag badge={view.badge} />
      </div>

      {/* FR-10: 장애인 가맹시설엔 접근성 태그(지원유형·편의시설) */}
      {isDvoucher && <AccessibilityTags view={view} />}
    </RowShell>
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

export function AltRow({
  a,
  index,
  onLocate,
}: {
  a: AlternativeFacility
  index?: number
  onLocate?: (id: string) => void
}) {
  const gb = faciGbLabel(a.faci_gb)
  // 공공·대안 풀에는 지원유형 조회 소스가 없다 — 원천이 준 불리언만 있으므로
  // "✓ 장애인 지원" 확언 대신 "장애인 지원(유형 미상)"으로 사실 그대로 적는다(C-3).
  const view = accessibilityView(a.disability_support)
  return (
    <RowShell
      testId="alt-facility"
      index={index}
      name={a.name}
      facilityId={a.id}
      locatable={a.coord_source !== 'centroid'}
      onLocate={onLocate}
      right={a.coord_source === 'centroid' ? null : <LocationLine coordSource={a.coord_source} dist={a.dist_km} />}
    >
      <p className="text-[13px] leading-[1.6] text-mute dark:text-mute-dark">
        {/* 서버 type 은 대안 풀 전체가 "공공체육시설"이라 신고·등록 시설도 그렇게 불린다 —
            faci_gb 를 아는 행은 원천 라벨을 쓴다(FR-04 AC7). */}
        <span className="text-ink dark:text-ink-dark">{a.faci_gb ? gb.label : a.type}</span>
        {' · '}
        {a.sports.join(' · ')}
      </p>
      <p className="text-[13px] leading-[1.6] text-mute dark:text-mute-dark">{a.note}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {a.coord_source === 'centroid' ? (
          <LocationLine coordSource={a.coord_source} dist={a.dist_km} />
        ) : (
          <span />
        )}
        {a.fee_month != null && (
          <span className="text-[12.5px] text-mute dark:text-mute-dark">월 {won(a.fee_month)}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {a.coord_source === 'centroid' && <ApproxLocationBadge />}
        <DisabilityTag badge={view.badge} />
      </div>
    </RowShell>
  )
}

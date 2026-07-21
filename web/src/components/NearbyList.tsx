import type { AlternativeFacility, Nearby, VoucherFacility } from '../types'
import { km, walkMinutes, won, wonPlain } from '../lib/format'
import { ApproxLocationBadge, Badge, CheckIcon } from './ui'

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
  const vouchers = nearby.voucher_facilities.filter((v) => matchesFilter(v.sports, filterSports))
  const alts = nearby.alternatives.filter((a) => matchesFilter(a.sports, filterSports))
  const filterActive = Boolean(filterSports && filterSports.length > 0)

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

      {vouchers.length > 0 && (
        <div data-testid="voucher-section">
          <h3 className="mb-2 text-sm font-semibold text-brand-700 dark:text-brand-100">이용권 가맹시설</h3>
          <ul className="space-y-2">
            {vouchers.map((v) => (
              <VoucherRow key={v.id} v={v} />
            ))}
          </ul>
        </div>
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

      {vouchers.length === 0 && alts.length === 0 && (
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
    <span className="text-xs text-slate-500 dark:text-slate-400">
      {km(dist)} · 도보 약 {walkMinutes(dist)}분
    </span>
  )
}

// 근사좌표(구 중심) 시설: 거리 대신 근사 안내. km 절대 표기 금지(카피 사전).
function ApproxTag() {
  return (
    <span className="text-xs text-slate-400 dark:text-slate-500">구 중심 근사 좌표 · 정확한 위치는 시설에 확인</span>
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

function VoucherRow({ v }: { v: VoucherFacility }) {
  const isDvoucher = v.source === 'dvoucher'
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{v.name}</p>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
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
      {v.addr && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{v.addr}</p>}

      {/* 자부담 계산 */}
      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-800/60">
        <div>
          <dt className="text-[11px] text-slate-500 dark:text-slate-400">월 수강료</dt>
          <dd className="text-sm font-semibold text-slate-800 dark:text-slate-100">{won(v.fee_month)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500 dark:text-slate-400">이용권 지원</dt>
          <dd className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">−{wonPlain(Math.min(v.subsidy, v.fee_month))}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500 dark:text-slate-400">내 부담</dt>
          <dd className="text-sm font-bold text-brand-700 dark:text-brand-100">{won(v.copay)}</dd>
        </div>
      </dl>

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
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
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

import type { SupplyGap } from '../types'
import { percent } from '../lib/format'
import { InfoIcon, WarnIcon } from './ui'

// 공급공백 정직 신호(SPEC §0-1, FR-04/FR-05). 이용권 시설 좌표는 실좌표가 아니라
// 시군구 중심 폴백이라 "반경 N km" 대신 구 단위로 집계한다("OO구 가맹 N곳").
// 반경 표기는 실좌표를 가진 공공 대안 풀에만 사용한다.
export function SupplyGapBanner({ gap }: { gap: SupplyGap }) {
  const isGap = gap.voucher_count === 0
  const near = gap.nearest
  // 최근접 표기: 실좌표면 km, 근사좌표(구 중심)면 '△△구'(km 미표기).
  const nearWhere = near
    ? near.coord_source === 'centroid' || near.dist_km == null
      ? near.sigungu_nm
      : `${near.dist_km}km`
    : null

  return (
    <div className="space-y-3">
      {isGap && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-500/50 dark:bg-amber-500/10"
        >
          <WarnIcon className="mt-0.5 w-6 h-6 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            {/* 이용권 블록: 구 단위 집계라 "반경" 문구가 없어야 한다(FR-04 AC2). */}
            <div data-testid="voucher-gap-block">
              <p className="font-bold text-amber-900 dark:text-amber-100">{gap.message}</p>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-200/90">
                이용권 가맹시설 위치는 구 중심 근사값이라 구 단위로 집계합니다. 빈자리를 임의로 채우지
                않고, 있는 그대로 알려드립니다.
                {near && (
                  <>
                    {' '}
                    가장 가까운 곳은 <b>{near.name}</b>
                    {nearWhere ? <>({nearWhere})</> : null}입니다.
                  </>
                )}
              </p>
            </div>
            {gap.alt_count > 0 && (
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-200/90">
                대신 반경 {gap.radius_km}km 내 <b>공공 대안 {gap.alt_count}곳</b>을 아래에서 확인하세요.
              </p>
            )}
          </div>
        </div>
      )}

      {/* 이용권 공급 있음: 구 단위 카운트("OO구 가맹 N곳")를 그대로 노출(FR-04 AC2). */}
      {!isGap && gap.voucher_scope === 'sigungu' && (
        <div
          data-testid="voucher-supply-block"
          className="flex items-start gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm dark:bg-slate-800/70"
        >
          <InfoIcon className="mt-0.5 w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
          <p className="text-slate-700 dark:text-slate-200">
            <b>{gap.message}</b>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
              이용권 가맹시설 위치는 구 중심 근사값이라 구 단위로 집계합니다(개별 거리 미표기).
            </span>
          </p>
        </div>
      )}

      {gap.coverage && (
        <div className="flex items-start gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm dark:bg-slate-800/70">
          <InfoIcon className="mt-0.5 w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
          <p className="text-slate-700 dark:text-slate-200">
            <b>{gap.coverage.sigungu}</b>의 {gap.coverage.class} 스포츠강좌이용권 수급률은{' '}
            <b className="text-rose-600 dark:text-rose-400">{percent(gap.coverage.rate)}</b> 입니다 (대상{' '}
            {gap.coverage.target.toLocaleString()}명 중 {gap.coverage.recipient}명 · {gap.coverage.year}).
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
              제도가 있어도 실제로 닿지 못하는 사각지대를 그대로 보여줍니다.
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

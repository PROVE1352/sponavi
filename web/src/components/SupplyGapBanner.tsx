import type { SupplyGap } from '../types'
import { percent } from '../lib/format'
import { InfoIcon, WarnIcon } from './ui'

// 공급공백 정직 신호(SPEC §0-1). voucher_count==0 이면 "빈자리 채우는 척" 대신 명확히 없음을 알린다.
export function SupplyGapBanner({ gap }: { gap: SupplyGap }) {
  const isGap = gap.voucher_count === 0
  return (
    <div className="space-y-3">
      {isGap && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-500/50 dark:bg-amber-500/10"
        >
          <WarnIcon className="mt-0.5 w-6 h-6 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-bold text-amber-900 dark:text-amber-100">{gap.message}</p>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-200/90">
              반경 {gap.radius_km}km 안에는 이용할 수 있는 가맹시설이 없습니다. 빈자리를 임의로
              채우지 않고, 있는 그대로 알려드립니다.
              {gap.nearest && (
                <>
                  {' '}
                  가장 가까운 곳은 <b>{gap.nearest.name}</b>({gap.nearest.dist_km}km)입니다.
                </>
              )}
            </p>
            {gap.alt_count > 0 && (
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-200/90">
                대신 반경 내 <b>공공 대안 {gap.alt_count}곳</b>을 아래에서 확인하세요.
              </p>
            )}
          </div>
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

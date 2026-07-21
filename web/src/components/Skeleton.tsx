// 공용 로딩 스켈레톤. 색+모양만으로 "불러오는 중"을 알리되, 스크린리더에는
// aria-busy + sr-only 텍스트로 상태를 전한다. 모션 최소화 선호는 index.css 전역 규칙이 존중.

// 단일 회색 블록(펄스). 장식이라 aria-hidden.
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-700/60 ${className}`}
    />
  )
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <div className="w-2/3 space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3.5 w-full" />
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-5/6" />
      </div>
      <Skeleton className="mt-4 h-20 w-full rounded-xl" />
    </div>
  )
}

// 결과 화면 3블록(경로·자격 카드·근처 리스트) 자리표시.
export function ResultSkeleton() {
  return (
    <div data-testid="result-skeleton" role="status" aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">결과를 불러오는 중입니다…</span>

      {/* (1) 경로 다이어그램 블록 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-3.5 w-2/3" />
        <div className="mt-4 flex items-center gap-2 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-24 shrink-0 rounded-xl" />
          ))}
        </div>
      </div>

      {/* (2) 자격 카드 3블록 */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <div className="grid gap-3 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>

      {/* (3) 근처 자원(지도+리스트) */}
      <div className="space-y-3">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-5 w-28" />
        <ListSkeleton rows={2} />
      </div>
    </div>
  )
}

// 리스트 자리표시(N행). 접근성/시설 목록 등 부분 로딩에 재사용.
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul aria-hidden="true" className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <li
          key={i}
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="w-2/3 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-12 w-full rounded-lg" />
        </li>
      ))}
    </ul>
  )
}

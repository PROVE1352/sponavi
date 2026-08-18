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

// (v2 챗 전환) 결과 3블록 자리표시(ResultSkeleton)는 ResultView 와 함께 제거됐다.
// 챗에서는 스트림 하단의 대기 표시(ChatStream)가 같은 역할을 한다.

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

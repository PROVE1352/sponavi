// 정직한 에러 패널. 실패해도 "데이터는 사라지지 않았다"는 안심 + 입력 보존 재시도 +
// 상세(코드·HTTP status) 접기. 거짓 데이터로 대체하지 않는다(정직 원칙).
import { ApiCallError, type ApiErrorKind } from '../api/client'
import { WarnIcon } from './ui'

export interface AppError {
  kind: ApiErrorKind
  message: string
  code: string
  status?: number
}

// 던져진 예외를 UI 용 구조체로. ApiCallError 면 종류/코드/상태를 보존한다.
export function toAppError(e: unknown): AppError {
  if (e instanceof ApiCallError) {
    return { kind: e.kind, message: e.message, code: e.code, status: e.status }
  }
  return {
    kind: 'unknown',
    message: '결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    code: 'UNKNOWN',
  }
}

function headline(kind: ApiErrorKind): string {
  if (kind === 'ratelimit') return '잠시만요 — 요청이 몰리고 있어요'
  if (kind === 'timeout') return '응답이 조금 늦어지고 있어요 — 데이터는 사라지지 않았어요'
  return '서버와 연결할 수 없습니다 — 데이터는 사라지지 않았어요'
}

export function ErrorPanel({
  error,
  onRetry,
  retrying = false,
}: {
  error: AppError
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <div
      role="alert"
      data-testid="error-panel"
      className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-5 dark:border-rose-500/40 dark:bg-rose-500/10"
    >
      <div className="flex items-start gap-3">
        <WarnIcon className="mt-0.5 h-6 w-6 shrink-0 text-rose-600 dark:text-rose-400" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-rose-900 dark:text-rose-100">{headline(error.kind)}</p>
          {/* 429 등은 서버 메시지를 그대로 노출 */}
          <p data-testid="error-message" className="mt-1 text-sm text-rose-800 dark:text-rose-200/90">
            {error.message}
          </p>
          <p className="mt-1 text-xs text-rose-700/80 dark:text-rose-200/70">
            입력하신 내용은 그대로 남아 있어요. 아래 버튼으로 다시 시도할 수 있습니다.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="assess-retry"
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-60"
            >
              {retrying ? '다시 시도하는 중…' : '다시 시도'}
            </button>
          </div>

          <details data-testid="error-detail" className="mt-3 text-xs text-rose-700/90 dark:text-rose-200/80">
            <summary className="cursor-pointer select-none font-medium">자세히</summary>
            <p className="mt-1">
              오류 코드: <span className="font-mono">{error.code}</span>
              {error.status != null && (
                <>
                  {' · '}
                  HTTP <span className="font-mono">{error.status}</span>
                </>
              )}
            </p>
          </details>
        </div>
      </div>
    </div>
  )
}

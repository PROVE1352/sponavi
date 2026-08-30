// 정직한 에러 패널. 실패해도 "데이터는 사라지지 않았다"는 안심 + 입력 보존 재시도 +
// 상세(코드·HTTP status) 접기. 거짓 데이터로 대체하지 않는다(정직 원칙).
import { ApiCallError, type ApiErrorKind } from '../api/client'
import { SECTION_RULE, WarnIcon } from './ui'

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
      className={SECTION_RULE}
    >
      <div className="flex items-start gap-2.5">
        <WarnIcon className="mt-1 h-5 w-5 shrink-0 text-accent-ink dark:text-accent-ink-dark" />
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[18px] font-extrabold text-ink dark:text-ink-dark">
            {headline(error.kind)}
          </p>
          {/* 429 등은 서버 메시지를 그대로 노출 */}
          <p
            data-testid="error-message"
            className="mt-1.5 text-[13.5px] leading-[1.65] text-ink dark:text-ink-dark"
          >
            {error.message}
          </p>
          <p className="mt-1 text-[12.5px] leading-[1.6] text-mute dark:text-mute-dark">
            입력하신 내용은 그대로 남아 있어요. 아래 버튼으로 다시 시도할 수 있습니다.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="assess-retry"
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-[3px] bg-ink px-4 py-2 text-[14px] font-bold text-paper transition-opacity hover:opacity-90 disabled:opacity-60 dark:bg-ink-dark dark:text-paper-dark"
            >
              {retrying ? '다시 시도하는 중…' : '다시 시도'}
            </button>
          </div>

          <details
            data-testid="error-detail"
            className="mt-3 text-[12px] text-mute dark:text-mute-dark"
          >
            <summary className="inline-flex min-h-11 cursor-pointer items-center select-none underline decoration-1 underline-offset-4">
              자세히
            </summary>
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

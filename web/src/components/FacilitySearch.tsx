// 동·도로명·시설명 검색(GET /api/facilities/search) — 근처 목록 위의 작은 검색창.
//
// 왜 필요한가: 이용권 가맹시설 대부분은 좌표가 구 중심 폴백이라 지도를 옮겨도 목록이 바뀌지
// 않는다(대구 북구 가맹 273곳 전부 근사 좌표). 그래서 "그 구 안에서 이름·주소로" 찾는다.
//
// 규약
//   · 검색은 제출(버튼/Enter = form submit)할 때만 — 글자마다 자동 검색하지 않는다.
//     한글 IME 조합 중 Enter 는 조합 확정이므로 제출하지 않는다(isComposing 가드).
//   · 이용권 행은 자격 판정 없이 온다(subsidy/copay=null) — 수강료만 보여 준다(P-1).
//   · 결과 수는 aria-live 로 알린다. 0건이면 도로명 주소의 한계를 정직하게 말한다.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { searchFacilities } from '../api/client'
import type {
  FacilitySearchResponse,
  FacilitySearchScope,
  SearchAltFacility,
  SearchVoucherFacility,
} from '../types_search'
import { BTN_TEXT, TINT_BOX, WarnIcon } from './ui'

export const SEARCH_Q_MAX = 30
export const SEARCH_LIMIT = 30
export const ZERO_HINT =
  '도로명 주소에는 동 이름이 없을 수 있어요. 도로명(예: 구암로)이나 시설 이름으로도 찾아보세요.'

export interface FacilitySearchResult {
  q: string
  vouchers: SearchVoucherFacility[]
  voucherTotal: number
  voucherTruncated: boolean
  alts: SearchAltFacility[]
  altTotal: number
  altTruncated: boolean
  // 두 요청 중 하나만 실패한 경우(부분 실패 격리) — 실패한 쪽 이름
  partialError: 'voucher' | 'public' | null
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; q: string }
  | { status: 'done'; result: FacilitySearchResult }
  | { status: 'error'; q: string; message: string }

export function useFacilitySearch(scope: FacilitySearchScope | undefined, resetKey: unknown) {
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const ctrl = useRef<AbortController | null>(null)

  const clear = useCallback(() => {
    ctrl.current?.abort()
    ctrl.current = null
    setState({ status: 'idle' })
  }, [])

  // 새 판정 결과(다른 지역·조건)가 오면 이전 검색은 버린다.
  useEffect(() => {
    clear()
  }, [resetKey, clear])

  useEffect(() => () => ctrl.current?.abort(), [])

  const run = useCallback(
    (raw: string) => {
      if (!scope) return
      const q = raw.split(/\s+/).filter(Boolean).join(' ')
      if (q.length === 0 || q.length > SEARCH_Q_MAX) return
      ctrl.current?.abort()
      const c = new AbortController()
      ctrl.current = c
      setState({ status: 'loading', q })
      const base = {
        sigungu_cd: scope.sigungu_cd,
        q,
        limit: SEARCH_LIMIT,
        ...(scope.origin ? { lat: scope.origin.lat, lon: scope.origin.lon } : {}),
        ...(scope.age != null ? { age: scope.age } : {}),
      }
      Promise.allSettled([
        searchFacilities({ ...base, program: scope.voucherProgram }, c.signal),
        searchFacilities({ ...base, program: 'public' }, c.signal),
      ]).then(([v, p]) => {
        if (c.signal.aborted || ctrl.current !== c) return
        if (v.status === 'rejected' && p.status === 'rejected') {
          const e = v.reason
          setState({
            status: 'error',
            q,
            message: e instanceof Error ? e.message : '검색하지 못했습니다.',
          })
          return
        }
        const vr: FacilitySearchResponse | null = v.status === 'fulfilled' ? v.value : null
        const pr: FacilitySearchResponse | null = p.status === 'fulfilled' ? p.value : null
        setState({
          status: 'done',
          result: {
            q,
            vouchers: (vr?.facilities ?? []) as SearchVoucherFacility[],
            voucherTotal: vr?.total ?? 0,
            voucherTruncated: vr?.truncated ?? false,
            alts: (pr?.facilities ?? []) as SearchAltFacility[],
            altTotal: pr?.total ?? 0,
            altTruncated: pr?.truncated ?? false,
            partialError: vr == null ? 'voucher' : pr == null ? 'public' : null,
          },
        })
      })
    },
    [scope],
  )

  return { state, run, clear }
}

export function FacilitySearchForm({
  sigunguLabel,
  busy,
  active,
  onSubmit,
  onClear,
}: {
  sigunguLabel?: string
  busy: boolean
  // 검색 결과가 목록을 대신하고 있는가("검색 지우기" 노출)
  active: boolean
  onSubmit: (q: string) => void
  onClear: () => void
}) {
  const id = useId()
  const [value, setValue] = useState('')
  const trimmed = value.trim()

  function submit(e: FormEvent) {
    e.preventDefault()
    if (trimmed.length === 0) return
    onSubmit(value)
  }

  // 한글 조합 확정용 Enter 는 제출이 아니다(조합 끝난 뒤의 Enter 만 제출).
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
  }

  function clear() {
    setValue('')
    onClear()
  }

  return (
    <form
      role="search"
      aria-label="시설 검색"
      data-testid="facility-search"
      onSubmit={submit}
      className="flex flex-col gap-1.5"
    >
      <label htmlFor={`${id}-q`} className="text-[13px] font-bold text-ink dark:text-ink-dark">
        동·도로명·시설명으로 찾기
      </label>
      <div className="flex items-stretch gap-2">
        <input
          id={`${id}-q`}
          data-testid="facility-search-input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          maxLength={SEARCH_Q_MAX}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="예: 구암로, 팔달동, 태권도"
          aria-describedby={`${id}-help`}
          className="min-h-11 min-w-0 flex-1 rounded-[3px] border-[1.5px] border-ink bg-paper px-3 text-[15px] text-ink placeholder:text-mute focus:outline-none focus-visible:ring-2 focus-visible:ring-ink dark:border-ink-dark dark:bg-paper-dark dark:text-ink-dark dark:placeholder:text-mute-dark dark:focus-visible:ring-ink-dark"
        />
        <button
          type="submit"
          data-testid="facility-search-submit"
          disabled={busy || trimmed.length === 0}
          className="press min-h-11 shrink-0 rounded-[3px] bg-ink px-4 font-serif text-[15px] font-extrabold text-paper transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-ink-dark dark:text-paper-dark"
        >
          찾기
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <p id={`${id}-help`} className="text-[12px] leading-[1.6] text-mute dark:text-mute-dark">
          {sigunguLabel ? `${sigunguLabel} 안에서 ` : ''}시설 이름·주소로 찾아요
        </p>
        {active && (
          <button
            type="button"
            data-testid="facility-search-clear"
            onClick={clear}
            className={BTN_TEXT}
          >
            검색 지우기
          </button>
        )}
      </div>
    </form>
  )
}

// 결과 수·상태 한 줄 — aria-live 로 낭독된다. 빈 문자열이어도 영역은 남겨 둔다(낭독 영역 유지).
export function SearchStatus({
  state,
}: {
  state: ReturnType<typeof useFacilitySearch>['state']
}) {
  let text = ''
  if (state.status === 'loading') text = `"${state.q}" 찾는 중…`
  else if (state.status === 'done') {
    const r = state.result
    text = `"${r.q}" ${r.voucherTotal + r.altTotal}곳 찾음`
  } else if (state.status === 'error') text = `검색하지 못했습니다: ${state.message}`
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="facility-search-status"
      className={
        text
          ? 'text-[13px] font-bold text-ink dark:text-ink-dark'
          : 'sr-only'
      }
    >
      {text}
    </p>
  )
}

export function SearchNotice({ children }: { children: string }) {
  return (
    <p className={`flex items-start gap-2 text-[13px] leading-[1.6] text-ink dark:text-ink-dark ${TINT_BOX}`}>
      <WarnIcon className="mt-0.5 h-4 w-4 shrink-0" />
      {children}
    </p>
  )
}

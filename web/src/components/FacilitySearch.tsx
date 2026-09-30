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
import type { FormEvent, KeyboardEvent, MouseEvent, RefObject } from 'react'
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

// 폼 동작이 포인터로 시작했는가, 키보드로 시작했는가 — 끝난 뒤 포커스 이동이 화면을 굴릴지 정한다
// (포인터면 focus({preventScroll}), 키보드면 기본 스크롤 · 계약 §6.11).
export type InputVia = 'pointer' | 'keyboard'

// 버튼 click 의 detail: 마우스·터치 누름은 1 이상, 키보드(Enter/Space)·입력칸 Enter 의 암묵 제출(기본 버튼에
// 합성 click)은 0 이다.
export function viaOfClick(e: { detail: number }): InputVia {
  return e.detail === 0 ? 'keyboard' : 'pointer'
}

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

  // scopeOverride: 이 요청만 다른 범위로(K6 "{label} 안에서 찾기"). 캡처된 scope 대신 인자로 받는다 —
  // 범위를 바꾸는 setState 직후에 부르면 클로저의 scope 는 아직 옛 값이다(stale closure).
  const run = useCallback(
    (raw: string, scopeOverride?: FacilitySearchScope) => {
      const s = scopeOverride ?? scope
      if (!s) return
      const q = raw.split(/\s+/).filter(Boolean).join(' ')
      if (q.length === 0 || q.length > SEARCH_Q_MAX) return
      ctrl.current?.abort()
      const c = new AbortController()
      ctrl.current = c
      setState({ status: 'loading', q })
      // 덮어쓴 범위(다른 시군구)에서는 거리 원점을 보내지 않고 거리도 싣지 않는다(P-1).
      const noDistance = s.override === true
      const base = {
        sigungu_cd: s.sigungu_cd,
        q,
        limit: SEARCH_LIMIT,
        ...(!noDistance && s.origin ? { lat: s.origin.lat, lon: s.origin.lon } : {}),
        ...(s.age != null ? { age: s.age } : {}),
      }
      Promise.allSettled([
        searchFacilities({ ...base, program: s.voucherProgram }, c.signal),
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
        const strip = <T extends { dist_km: number | null }>(rows: T[]): T[] =>
          noDistance ? rows.map((r) => ({ ...r, dist_km: null })) : rows
        setState({
          status: 'done',
          result: {
            q,
            vouchers: strip((vr?.facilities ?? []) as SearchVoucherFacility[]),
            voucherTotal: vr?.total ?? 0,
            voucherTruncated: vr?.truncated ?? false,
            alts: strip((pr?.facilities ?? []) as SearchAltFacility[]),
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
  help,
  busy,
  active,
  onSubmit,
  onClear,
  initialValue = '',
  inputRef,
  onScopeReset,
}: {
  sigunguLabel?: string
  // 도움말 문장을 통째로 바꿀 때(지도 범위 모드 · 검색 범위 덮어쓰기). 없으면 "{시군구} 안에서 …".
  help?: string
  busy: boolean
  // 검색 결과가 목록을 대신하고 있는가("검색 지우기" 노출)
  active: boolean
  // via: 제출이 포인터(찾기 버튼 누름)로 시작했나, 키보드(입력칸 Enter·버튼에서 Enter/Space)로 시작했나
  onSubmit: (q: string, via: InputVia) => void
  onClear: (via: InputVia) => void
  // 모드가 바뀔 때 부모가 key 를 바꿔 다시 마운트한다 — 그때 입력칸에 채워 둘 값.
  initialValue?: string
  inputRef?: RefObject<HTMLInputElement | null>
  // 검색 범위를 다른 시군구로 덮어쓴 동안만: "내 지역으로"
  onScopeReset?: () => void
}) {
  const id = useId()
  const [value, setValue] = useState(initialValue)
  const trimmed = value.trim()
  // 이번 제출의 시작 방식. 찾기 버튼의 click 이 submit 보다 먼저 온다 — 입력칸 Enter 도 기본 버튼에 합성
  // click(detail 0)을 보낸 뒤 제출하므로 두 경로 모두 여기서 가려진다. 기본값은 키보드(click 없는 제출).
  const submitVia = useRef<InputVia>('keyboard')

  function submit(e: FormEvent) {
    e.preventDefault()
    const via = submitVia.current
    submitVia.current = 'keyboard'
    if (trimmed.length === 0) return
    onSubmit(value, via)
  }

  // 한글 조합 확정용 Enter 는 제출이 아니다(조합 끝난 뒤의 Enter 만 제출).
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
  }

  function clear(e: MouseEvent<HTMLButtonElement>) {
    setValue('')
    onClear(viaOfClick(e))
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
          ref={inputRef}
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
          onClick={(e) => {
            submitVia.current = viaOfClick(e)
          }}
          className="press min-h-11 shrink-0 rounded-[3px] bg-ink px-4 font-serif text-[15px] font-extrabold text-paper transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-ink-dark dark:text-paper-dark"
        >
          찾기
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <p id={`${id}-help`} className="text-[12px] leading-[1.6] text-mute dark:text-mute-dark">
          {help ?? `${sigunguLabel ? `${sigunguLabel} 안에서 ` : ''}시설 이름·주소로 찾아요`}
        </p>
        <div className="flex flex-wrap items-center gap-x-3">
          {onScopeReset && (
            <button
              type="button"
              data-testid="facility-search-scope-reset"
              onClick={onScopeReset}
              className={BTN_TEXT}
            >
              내 지역으로
            </button>
          )}
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

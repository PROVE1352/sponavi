// API 클라이언트. 베이스 `/api`.
// VITE_MOCK=1 이면 서버 없이 src/mocks 의 계약-형태 응답으로 완전 동작(데모/검증용).
// 아니면 실서버(FastAPI, dev proxy → 127.0.0.1:8000)로 요청.
//
// 회복탄력성(서버가 아플 때도 품위 있게):
//   · 타임아웃(assess 10s · fitness 15s · ai 95s) — AbortController 기반.
//   · 네트워크 실패 / 5xx / 429 를 에러 "종류(kind)"로 구분해 UI가 정직하게 대응.
//   · GET(멱등)만 1회 자동 재시도. POST 는 재시도 금지(중복 부작용 방지).
//   · 429 는 서버가 준 메시지를 그대로 노출(가공 금지).

import type {
  ApiError,
  AssessRequest,
  AssessResponse,
  DemoPersona,
  FitnessAiResponse,
  FitnessItemsResponse,
  FitnessRequest,
  FitnessResponse,
  Sigungu,
} from '../types'
import type { AccessibilityMap } from '../types_accessibility'
import {
  FITNESS_RESPONSE,
  PERSONA_REQUESTS,
  SIGUNGU,
  mockFitness,
  mockFitnessAi,
  mockFitnessItems,
  resolveMockAssess,
} from '../mocks'
import { resolveMockAccessibility } from '../mocks/accessibility'

export const IS_MOCK = import.meta.env.VITE_MOCK === '1'

const BASE = '/api'

// 데이터 기준일 폴백(푸터). /api/health 의 data_built 가 없거나 조회 실패 시 사용.
export const DATA_BUILT_FALLBACK = '2026-07-20'

// 목 빌드에서도 실네트워크 경로를 강제하는 런타임 탈출구(프리뷰/e2e 전용).
//   ?live=1 (또는 ?mock=0) 쿼리, 혹은 window.__SPONAVI_LIVE__ === true.
// 목 빌드는 데모 배포용이라 라이브 강제 시 실제 서버가 없으면 그대로 실패하는데,
// 이는 의도된 동작(거짓 데이터로 대체하지 않는다). e2e 는 route 인터셉트로 응답을 준다.
function liveOverride(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const p = new URLSearchParams(window.location.search)
    if (p.get('live') === '1' || p.get('mock') === '0') return true
  } catch {
    /* URL 파싱 불가 시 무시 */
  }
  return (window as unknown as { __SPONAVI_LIVE__?: boolean }).__SPONAVI_LIVE__ === true
}

// 이 호출을 목 데이터로 처리할지 여부. 렌더 시점마다 평가(쿼리 토글 반영).
export function useMockData(): boolean {
  return IS_MOCK && !liveOverride()
}

// 목 모드에서 네트워크 지연을 살짝 흉내(로딩 UI 확인용). 검증 환경에선 짧게.
function delay<T>(value: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

// 에러 종류 — UI 가 상황별로 정직하게 대응하기 위한 분류.
//   network   : 연결 자체 실패(오프라인/DNS/거부)
//   timeout   : 시간 초과(AbortController)
//   server    : 5xx (일시적, 재시도 가치 있음)
//   ratelimit : 429 (요청 과다 — 서버 메시지 그대로 노출)
//   client    : 그 외 4xx (요청 문제 — 재시도해도 동일)
//   canceled  : 사용자가 취소(예: AI 처방 취소) — 에러로 표시하지 않음
//   parse     : 200 이지만 본문 해석 실패
export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'server'
  | 'ratelimit'
  | 'client'
  | 'canceled'
  | 'parse'
  | 'unknown'

export class ApiCallError extends Error {
  kind: ApiErrorKind
  code: string
  status?: number
  // 자동 재시도(멱등 GET) 대상인가 — network/timeout/server 만 true.
  retryable: boolean
  constructor(
    kind: ApiErrorKind,
    code: string,
    message: string,
    opts: { status?: number; retryable?: boolean } = {},
  ) {
    super(message)
    this.name = 'ApiCallError'
    this.kind = kind
    this.code = code
    this.status = opts.status
    this.retryable = opts.retryable ?? false
  }
}

interface RequestOpts {
  timeoutMs: number
  // 멱등 요청만 true. 실패(network/timeout/5xx) 시 1회 자동 재시도.
  retry?: boolean
  // 외부 취소 신호(예: AI 처방 취소 버튼).
  signal?: AbortSignal
}

// 단일 시도: 타임아웃·외부취소를 AbortController 로 묶고, 응답을 kind 로 분류.
async function attempt<TRes>(path: string, init: RequestInit, opts: RequestOpts): Promise<TRes> {
  const ctrl = new AbortController()
  const external = opts.signal
  const onExternalAbort = () => ctrl.abort()
  if (external) {
    if (external.aborted) ctrl.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs)

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal })
  } catch {
    // abort 는 외부취소/타임아웃 둘 다에서 온다 — 원인으로 구분.
    if (external?.aborted) {
      throw new ApiCallError('canceled', 'CANCELED', '요청을 취소했습니다')
    }
    if (ctrl.signal.aborted) {
      throw new ApiCallError('timeout', 'TIMEOUT', '응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.', {
        retryable: true,
      })
    }
    throw new ApiCallError('network', 'NETWORK', '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.', {
      retryable: true,
    })
  } finally {
    clearTimeout(timer)
    if (external) external.removeEventListener('abort', onExternalAbort)
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null
    const serverMsg = body?.error?.message
    const code = body?.error?.code ?? `HTTP_${res.status}`
    if (res.status === 429) {
      // 429: 서버가 준 메시지를 그대로. 없으면 최소한의 안내.
      throw new ApiCallError('ratelimit', code, serverMsg ?? '요청이 많아요. 잠시 후 다시 시도해 주세요.', {
        status: 429,
      })
    }
    if (res.status >= 500) {
      throw new ApiCallError('server', code, serverMsg ?? '서버에 일시적인 문제가 발생했습니다.', {
        status: res.status,
        retryable: true,
      })
    }
    throw new ApiCallError('client', code, serverMsg ?? '요청을 처리할 수 없습니다.', {
      status: res.status,
    })
  }

  try {
    return (await res.json()) as TRes
  } catch {
    throw new ApiCallError('parse', 'PARSE', '서버 응답을 해석할 수 없습니다.')
  }
}

async function request<TRes>(path: string, init: RequestInit, opts: RequestOpts): Promise<TRes> {
  const maxAttempts = opts.retry ? 2 : 1
  let lastErr: unknown
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await attempt<TRes>(path, init, opts)
    } catch (e) {
      lastErr = e
      const canRetry =
        i < maxAttempts - 1 && e instanceof ApiCallError && e.retryable && !opts.signal?.aborted
      if (!canRetry) throw e
    }
  }
  throw lastErr
}

function post<TReq, TRes>(path: string, body: TReq, timeoutMs: number, signal?: AbortSignal): Promise<TRes> {
  return request<TRes>(
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    { timeoutMs, retry: false, signal }, // POST 는 재시도 금지(중복 부작용).
  )
}

function get<TRes>(path: string, timeoutMs = 10_000, signal?: AbortSignal): Promise<TRes> {
  return request<TRes>(path, {}, { timeoutMs, retry: true, signal }) // GET 은 멱등 → 1회 재시도.
}

export function assess(req: AssessRequest): Promise<AssessResponse> {
  if (useMockData()) return delay(resolveMockAssess(req))
  return post<AssessRequest, AssessResponse>('/assess', req, 10_000)
}

export function fitness(req: FitnessRequest): Promise<FitnessResponse> {
  if (useMockData()) return delay(req.age ? mockFitness(req) : FITNESS_RESPONSE)
  return post<FitnessRequest, FitnessResponse>('/fitness', req, 15_000)
}

// 연령군별 측정항목 카탈로그(동적 폼). 목모드는 계약-형태 목 카탈로그.
export function getFitnessItems(age: number): Promise<FitnessItemsResponse> {
  if (useMockData()) return delay(mockFitnessItems(age), 0)
  return get<FitnessItemsResponse>(`/fitness/items?age=${encodeURIComponent(age)}`, 10_000)
}

// AI(또는 규칙) 처방. 목모드는 규칙 폴백 형태(provider="rules"). AI 는 오래 걸릴 수 있어 95s + 취소 가능.
export function fitnessAi(req: FitnessRequest, signal?: AbortSignal): Promise<FitnessAiResponse> {
  if (useMockData()) return delay(mockFitnessAi(req), 300)
  return post<FitnessRequest, FitnessAiResponse>('/fitness/ai', req, 95_000, signal)
}

export function getSigungu(): Promise<Sigungu[]> {
  if (useMockData()) return delay(SIGUNGU, 0)
  return get<Sigungu[]>('/meta/sigungu', 10_000)
}

// ---- GET /api/health ----  (푸터 데이터 기준일/버전 · 서버가 추가 중이라 옵셔널로 다룬다)
export interface HealthResponse {
  status?: string
  // 데이터 빌드일(YYYY-MM-DD). 없을 수도 있음(서버가 추가 중) → 푸터는 폴백.
  data_built?: string
  version?: string
  [k: string]: unknown
}

export function getHealth(): Promise<HealthResponse> {
  // 목 모드: 서버가 없으므로 폴백 기준일로 정적 응답(푸터가 하드코딩과 동일하게 보이도록).
  if (useMockData()) return delay<HealthResponse>({ status: 'ok', data_built: DATA_BUILT_FALLBACK }, 0)
  return get<HealthResponse>('/health', 8_000)
}

// API.md는 /demo/personas 가 "assess 요청 바디 배열"이라고만 명시한다. 실서버는
// {id,label,expected,body:{...assess}} 로 바디를 중첩해 반환(실측 2026-07-20) — 둘 다 흡수한다.
function normalizePersona(
  raw: Partial<DemoPersona> & Partial<AssessRequest> & { body?: AssessRequest; expected?: string },
  i: number,
): DemoPersona {
  const src: AssessRequest = raw.body ?? (raw as AssessRequest)
  const id = raw.id ?? `P${i + 1}`
  const disTxt = src.disability?.has ? ` · ${src.disability.type ?? ''}장애` : ''
  const label =
    raw.label ?? `${id} · ${src.age}세 ${src.sex === 'F' ? '여' : '남'} · ${src.income_class}${disTxt}`
  const summary = raw.summary ?? raw.expected ?? `${src.sigungu_nm} 기준 예상 자격과 경로를 확인합니다`
  return { ...src, id, label, summary }
}

export async function getPersonas(): Promise<DemoPersona[]> {
  if (useMockData()) return delay(PERSONA_REQUESTS, 0)
  const raw = await get<(Partial<DemoPersona> & Partial<AssessRequest> & { body?: AssessRequest })[]>(
    '/demo/personas',
    10_000,
  )
  return raw.map(normalizePersona)
}

// FR-10 접근성 배치 조회. id 배열 → {id: {types, amenities, source, checked}}.
// 데이터 없는 id 는 응답에서 생략된다(P-1). 실패해도 assess 전 기능은 그대로 동작(DR-4).
export function getAccessibility(ids: string[]): Promise<AccessibilityMap> {
  const clean = Array.from(new Set(ids.filter(Boolean)))
  if (clean.length === 0) return Promise.resolve({})
  if (useMockData()) return delay(resolveMockAccessibility(clean), 0)
  const q = clean.map(encodeURIComponent).join(',')
  return get<AccessibilityMap>(`/accessibility?ids=${q}`, 10_000)
}

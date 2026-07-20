// API 클라이언트. 베이스 `/api`.
// VITE_MOCK=1 이면 서버 없이 src/mocks 의 계약-형태 응답으로 완전 동작(데모/검증용).
// 아니면 실서버(FastAPI, dev proxy → 127.0.0.1:8000)로 요청.

import type {
  ApiError,
  AssessRequest,
  AssessResponse,
  DemoPersona,
  FitnessRequest,
  FitnessResponse,
  Sigungu,
} from '../types'
import {
  FITNESS_RESPONSE,
  PERSONA_REQUESTS,
  SIGUNGU,
  mockFitness,
  resolveMockAssess,
} from '../mocks'

export const IS_MOCK = import.meta.env.VITE_MOCK === '1'

const BASE = '/api'

// 목 모드에서 네트워크 지연을 살짝 흉내(로딩 UI 확인용). 검증 환경에선 짧게.
function delay<T>(value: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

export class ApiCallError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiCallError'
  }
}

async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiError | null
    throw new ApiCallError(err?.error?.code ?? 'HTTP_' + res.status, err?.error?.message ?? '요청 처리 중 오류가 발생했습니다')
  }
  return (await res.json()) as TRes
}

async function get<TRes>(path: string): Promise<TRes> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiError | null
    throw new ApiCallError(err?.error?.code ?? 'HTTP_' + res.status, err?.error?.message ?? '요청 처리 중 오류가 발생했습니다')
  }
  return (await res.json()) as TRes
}

export function assess(req: AssessRequest): Promise<AssessResponse> {
  if (IS_MOCK) return delay(resolveMockAssess(req))
  return post<AssessRequest, AssessResponse>('/assess', req)
}

export function fitness(req: FitnessRequest): Promise<FitnessResponse> {
  if (IS_MOCK) return delay(req.age ? mockFitness(req) : FITNESS_RESPONSE)
  return post<FitnessRequest, FitnessResponse>('/fitness', req)
}

export function getSigungu(): Promise<Sigungu[]> {
  if (IS_MOCK) return delay(SIGUNGU, 0)
  return get<Sigungu[]>('/meta/sigungu')
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
  if (IS_MOCK) return delay(PERSONA_REQUESTS, 0)
  const raw = await get<(Partial<DemoPersona> & Partial<AssessRequest> & { body?: AssessRequest })[]>(
    '/demo/personas',
  )
  return raw.map(normalizePersona)
}

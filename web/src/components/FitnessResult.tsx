// 판정 결과 턴 (FR-08·09) — 밴드 칩·비교문·참고 등급(추정)·그래프 추천(출처 배지·연결 종목)·
// 영상 카드·"이 운동 되는 근처 강좌" 필터·AI 처방(정직 라벨 + 항목별 "왜 이 운동?" 펼침).
// 사실은 전부 엔진 출력이다 — 이 컴포넌트는 서버가 준 문장을 그대로 표시만 한다(P-2).

import { useMemo } from 'react'
import type {
  AiPrescription,
  FitnessAiResponse,
  FitnessRecommendation,
  FitnessResponse,
  GraphNamed,
  GraphVideo,
  Nearby,
  Provenance,
} from '../types'
import type { AppError } from './ErrorPanel'
import { FITNESS_DISCLAIMER } from './FitnessForm'
import { Badge, CheckIcon, InfoIcon, WarnIcon } from './ui'

type BadgeTone = 'neutral' | 'brand' | 'ok' | 'fail' | 'warn' | 'purple'

// 엣지 출처 → UI 배지(FITNESS_GRAPH §2.3). 근거 없는 추천은 서버가 내보내지 않는다.
function sourceBadge(prov?: Provenance): { label: string; tone: BadgeTone } | null {
  if (!prov) return null
  switch (prov.source) {
    case 'kspo_standard':
      return { label: '공단 공식 기준', tone: 'ok' }
    case 'guideline':
      // 카피 사전(PRD §6 · FITNESS_GRAPH §2.3) 고정 문구 — A급은 "정부·국제 지침".
      return { label: '정부·국제 지침', tone: 'brand' }
    case 'kspo_video':
      return { label: '공단 콘텐츠', tone: 'neutral' }
    case 'curated':
      return {
        label: prov.curated_status === 'pending' ? '전문가 큐레이션(검증 중)' : '전문가 큐레이션',
        tone: 'purple',
      }
    default:
      return { label: '참고', tone: 'neutral' }
  }
}

function named(x: GraphNamed | string): { name: string; prov?: Provenance } {
  return typeof x === 'string' ? { name: x } : { name: x.name, prov: x.provenance }
}

// 멀티홉 표기(FITNESS_GRAPH §3.5): "via {goal}" 대신 한국어로. 경로 등급은 서버가 이미
// 두 홉 중 약한 쪽으로 내려 잡아 보냈다 — 화면은 그 사실을 바꾸지 않고 경유만 밝힌다.
function viaGoalLabel(prov?: Provenance): string | null {
  return prov?.via_goal ? `${prov.via_goal} 목적 경유` : null
}

function bandTone(band: string): BadgeTone {
  if (band.includes('미달')) return 'fail'
  if (band.includes('1등급')) return 'ok'
  if (band.includes('신체조성') || band.includes('참고')) return 'neutral'
  return 'brand'
}

export function FitnessResultCard({
  result,
  nearby,
  onApplyFilter,
  ai,
  aiLoading,
  aiError,
  onRequestAi,
  onCancelAi,
  // 최신 결과 카드에만 AI 처방 조작부를 붙인다(지난 결과는 기록으로 고정).
  showAi = true,
}: {
  result: FitnessResponse
  nearby: Nearby
  onApplyFilter: (sports: string[]) => void
  ai: FitnessAiResponse | null
  aiLoading: boolean
  aiError: AppError | null
  onRequestAi: () => void
  onCancelAi: () => void
  showAi?: boolean
}) {
  const items = result.items ?? []
  const rg = result.reference_grade
  const sports = result.facility_filter_sports ?? []
  const matchCount = useMemo(() => {
    if (sports.length === 0) return 0
    const set = new Set(sports)
    return [...nearby.voucher_facilities, ...nearby.alternatives].filter((f) =>
      f.sports.some((s) => set.has(s)),
    ).length
  }, [sports, nearby])

  return (
    <section
      data-testid="fitness-result"
      aria-label="체력 판정 결과"
      className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="ok" icon={<CheckIcon className="h-3.5 w-3.5" />}>
          국민체력100 공식 인증기준
        </Badge>
        {result.age_group && (
          <span className="text-xs text-slate-600 dark:text-slate-400">{result.age_group}</span>
        )}
      </div>

      {/* ① 항목별 band 칩 + 비교문 */}
      {items.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">항목별 판정</h4>
          <ul className="mt-2 space-y-1.5">
            {items.map((it) => (
              <li
                key={it.code}
                data-testid="item-band"
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <Badge tone={bandTone(it.band)}>{it.band}</Badge>
                <span className="text-slate-600 dark:text-slate-300">{it.comparison}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ② 참고등급(추정) + 미입력 요인 + 인증센터 안내 */}
      {rg && (
        <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
          <div className="flex items-center gap-2">
            <Badge tone="warn" icon={<InfoIcon className="h-3.5 w-3.5" />}>
              {rg.label}
            </Badge>
            {rg.grade != null && (
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {rg.grade}등급 수준(추정)
              </span>
            )}
          </div>
          {rg.missing.length > 0 && (
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
              미입력 요인: {rg.missing.join(', ')} — 전 항목 측정 시에만 공식 등급이 확정됩니다.
            </p>
          )}
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            자가입력 기준 추정값입니다. <b>공식 인증은 체력인증센터(무료)</b>에서 받을 수 있습니다.
          </p>
        </div>
      )}

      {/* ③ 약점별 추천 블록 (출처 배지 + 영상 카드) */}
      {result.recommendations.length > 0 ? (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">약점별 추천</h4>
          {result.recommendations.map((r, i) => (
            <RecommendationBlock key={i} rec={r} />
          ))}
        </div>
      ) : (
        result.weaknesses.length === 0 && (
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
            입력한 항목에서는 기준 미달 약점이 발견되지 않았습니다.
          </p>
        )
      )}

      {/* ④ 이 운동 되는 근처 강좌 — 시설 리스트 필터 연동 */}
      {sports.length > 0 && (
        <button
          type="button"
          data-testid="facility-filter-apply"
          onClick={() => onApplyFilter(sports)}
          className="min-h-11 w-full rounded-lg border-2 border-brand-600 px-4 py-2.5 text-left font-semibold text-brand-700 transition hover:bg-brand-50 dark:text-brand-100 dark:hover:bg-brand-700/20"
        >
          이 운동 되는 근처 강좌 보기 · {sports.join(' · ')}
          <span className="ml-1 font-normal text-brand-700 dark:text-brand-100">
            (근처 {matchCount}곳)
          </span>
        </button>
      )}

      {/* ⑤ AI 처방 — 진행 문구("최대 1분") + 취소, 실패 시(429 등) 정직한 안내 */}
      {showAi && (
        <div className="space-y-2">
          {!aiLoading && (
            <button
              type="button"
              data-testid="ai-prescribe-btn"
              onClick={onRequestAi}
              className="min-h-11 w-full rounded-lg bg-slate-800 px-4 py-2.5 font-semibold text-white transition hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              {ai || aiError ? 'AI 처방 다시 받기' : 'AI 처방 받기'}
            </button>
          )}
          {aiLoading && (
            <div
              role="status"
              data-testid="ai-progress"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
            >
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-300"
                />
                처방 문장을 만드는 중 — 최대 1분
              </span>
              <button
                type="button"
                data-testid="ai-cancel"
                onClick={onCancelAi}
                className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                취소
              </button>
            </div>
          )}
          {aiError && !aiLoading && (
            <div
              role="alert"
              data-testid="ai-error"
              className={`rounded-lg border p-3 text-sm ${
                aiError.kind === 'ratelimit'
                  ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200'
                  : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200'
              }`}
            >
              {aiError.kind === 'ratelimit'
                ? aiError.message
                : 'AI 처방을 불러오지 못했어요. 위 규칙 기반 추천을 참고하시고, 잠시 후 다시 시도해 주세요.'}
            </div>
          )}
          {ai && <AiResult ai={ai} />}
        </div>
      )}

      {/* 하단 고정 고지(FR-08 AC5) */}
      <p className="border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
        {FITNESS_DISCLAIMER}
      </p>
    </section>
  )
}

function RecommendationBlock({ rec }: { rec: FitnessRecommendation }) {
  const exercises = (rec.exercises as (GraphNamed | string)[]).map(named)
  const sports = ((rec.sports ?? []) as (GraphNamed | string)[]).map(named)
  const videos = (rec.videos ?? []) as GraphVideo[]
  // 그래프가 이 요인에 아무것도 잇지 못한 경우(예: 고아 요인) — 빈 블록을 조용히 남기지 않고
  // 근거가 없다고 말한다(P-1). 없는 추천을 지어내지 않는다.
  const empty = exercises.length === 0 && sports.length === 0 && videos.length === 0
  return (
    <div data-testid="rec-block" className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="font-semibold text-slate-800 dark:text-slate-100">{rec.weakness}</p>

      {empty && (
        <p
          data-testid="rec-empty"
          className="mt-2 flex items-start gap-1.5 text-sm text-slate-600 dark:text-slate-400"
        >
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
          이 요인에 연결된 그래프 근거가 아직 없습니다 — 근거 없는 추천은 만들지 않습니다.
        </p>
      )}

      {exercises.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {exercises.map((e, i) => {
            const badge = sourceBadge(e.prov)
            const via = viaGoalLabel(e.prov)
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-700 dark:text-slate-200">{e.name}</span>
                {badge && (
                  <span data-testid="source-badge">
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </span>
                )}
                {via && (
                  <span data-testid="rec-via-goal" className="text-xs text-slate-600 dark:text-slate-400">
                    {via}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* 연결 종목 — 필터 버튼에는 이름만 남지만, 검증 상태는 여기서 그대로 보인다(P-1).
          B티어(유도·주짓수 등)가 "전문가 큐레이션(검증 중)" 인 사실을 화면에서 감추지 않는다. */}
      {sports.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">연결 종목</p>
          <ul data-testid="rec-sports" className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {sports.map((s, i) => {
              const badge = sourceBadge(s.prov)
              return (
                <li
                  key={i}
                  data-testid="rec-sport"
                  className="flex flex-wrap items-center gap-1.5 text-sm"
                >
                  <span className="text-slate-700 dark:text-slate-200">{s.name}</span>
                  {badge && (
                    <span data-testid="source-badge">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {videos.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-3">
          {videos.slice(0, 3).map((v, i) => (
            <li key={i} data-testid="video-card" className="w-32">
              <a href={v.url ?? '#'} target="_blank" rel="noreferrer noopener" className="block">
                {v.img_url ? (
                  <img
                    src={v.img_url}
                    alt={v.title}
                    className="h-[72px] w-32 rounded-md object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                  />
                ) : (
                  <div className="grid h-[72px] w-32 place-items-center rounded-md bg-slate-100 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    영상
                  </div>
                )}
                <span className="mt-1 block truncate text-xs text-brand-700 underline underline-offset-2 dark:text-brand-100">
                  {v.title}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// provider 정직 라벨(FR-08 AC3) — AI가 아니면 "기본 규칙 처방"이라고 그대로 말한다.
function AiResult({ ai }: { ai: FitnessAiResponse }) {
  const isAi = ai.provider === 'claude' || ai.provider === 'gemini'
  return (
    <div data-testid="ai-result" className="mt-3 space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
      <div className="flex items-center gap-2">
        <Badge tone={isAi ? 'purple' : 'brand'}>
          <span data-testid="ai-provider-label">{isAi ? 'AI 보조 처방' : '기본 규칙 처방'}</span>
        </Badge>
        <span className="text-xs text-slate-600 dark:text-slate-400">provider: {ai.provider}</span>
      </div>

      {ai.처방.length > 0 && (
        <ul className="space-y-2">
          {ai.처방.map((rx, i) => (
            <li key={i} data-testid="ai-rx" className="rounded-lg bg-white p-3 text-sm dark:bg-slate-900">
              <p className="font-semibold text-slate-800 dark:text-slate-100">
                {rx.운동}
                <span className="ml-2 text-xs font-normal text-slate-600 dark:text-slate-400">
                  {rx.목표체력요인}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                강도: {rx.강도} · 빈도: {rx.주당빈도}
              </p>
              <RxWhy rx={rx} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-600 dark:text-slate-400">{ai.주의}</p>
    </div>
  )
}

// 강도·빈도 수치의 출처 — ai.py FITT 수치사전의 하드코드 원천 그대로(창작 아님).
const FITT_SOURCE = 'FITT 수치: 정부·국제 지침(보건복지부 2023 · WHO 2020 · ACSM)'

// 근거 경로 한 줄. 그래프가 실제로 지나온 홉만 문장으로 옮긴다.
//   직접  : "약점 {요인} ← {운동}"
//   멀티홉: "{운동} → {목적} 목적 운동 → {요인}"
function evidencePath(rx: AiPrescription): string {
  const factor = rx.목표체력요인 || '약점 요인'
  const goal = rx.provenance?.via_goal
  return goal ? `${rx.운동} → ${goal} 목적 운동 → ${factor}` : `약점 ${factor} ← ${rx.운동}`
}

// FR-08 AC8 "왜 이 운동?" 펼침. 자격 카드의 사유(FR-02)와 같은 UX 문법 —
// 아이콘+문장 행을 <ul> 로 쌓고 상태는 색+아이콘+텍스트 삼중으로 표기(A11Y-3).
// 근거(provenance)가 없는 항목은 펼치지 않고 "근거 정보 없음"이라고 말한다(P-1).
function RxWhy({ rx }: { rx: AiPrescription }) {
  const prov = rx.provenance ?? undefined
  const badge = sourceBadge(prov)
  const rowCls = 'flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200'

  if (!prov || !badge) {
    return (
      <p
        data-testid="rx-why-none"
        className="mt-2 flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-400"
      >
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        근거 정보 없음 — 이 항목에 연결된 그래프 근거를 확인할 수 없습니다.
      </p>
    )
  }

  const pending = prov.curated_status === 'pending'
  const via = viaGoalLabel(prov)
  return (
    <details data-testid="rx-why" className="mt-2">
      <summary
        data-testid="rx-why-toggle"
        aria-label={`왜 이 운동? ${rx.운동}`}
        className="inline-flex min-h-11 cursor-pointer items-center text-xs font-semibold text-brand-800 underline decoration-dotted underline-offset-2 dark:text-brand-100"
      >
        왜 이 운동?
      </summary>
      <ul data-testid="rx-why-panel" className="mt-1 space-y-1.5">
        <li className={rowCls}>
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-100" />
          <span>근거 경로: {evidencePath(rx)}</span>
        </li>
        <li className={`${rowCls} flex-wrap`}>
          {pending ? (
            <WarnIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
          ) : (
            <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
          <span className="inline-flex flex-wrap items-center gap-1.5">
            출처
            <span data-testid="rx-why-badge">
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </span>
            {/* 배지 문구에 이미 "검증 중"이 없는데 pending 이면 상태를 따로 붙인다(숨기지 않음) */}
            {pending && !badge.label.includes('검증 중') && <Badge tone="warn">검증 중</Badge>}
          </span>
        </li>
        {via && (
          <li className={rowCls}>
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
            <span>{via} — 경로 등급은 두 홉 중 약한 쪽으로 표기합니다.</span>
          </li>
        )}
        <li className={rowCls}>
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
          <span>{FITT_SOURCE}</span>
        </li>
      </ul>
    </details>
  )
}

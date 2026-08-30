// 판정 결과 턴 (FR-08·09) — 등급 라벨·비교문·참고 등급(추정)·그래프 추천(근거 표기·연결 종목)·
// 영상 카드·"이 운동 되는 근처 강좌" 필터·AI 처방(정직 라벨 + 항목별 근거 블록 항상 노출).
// 사실은 전부 엔진 출력이다 — 이 컴포넌트는 서버가 준 문장을 그대로 표시만 한다(P-2).
//
// B · 종이 메모: 카드 상자 없이 2px 잉크 괘선으로 나뉜 섹션 + 항목 점선.

import { useMemo, useState } from 'react'
import type {
  FitnessAiResponse,
  FitnessRecommendation,
  FitnessResponse,
  GraphNamed,
  GraphVideo,
  Nearby,
  Provenance,
} from '../types'
import type { AppError } from './ErrorPanel'
import { countMatching, nearbyMatchText } from '../lib/sports'
import { dedupeDisplayTitles } from '../lib/format'
import { FITNESS_DISCLAIMER } from './FitnessForm'
import {
  BTN_LINE,
  BTN_TEXT,
  CheckIcon,
  ITEM_RULE,
  InfoIcon,
  PlayIcon,
  ROW_RULE,
  SECTION_RULE,
  TINT_BOX,
  WarnIcon,
} from './ui'

// 근거 표기 톤: 공식·지침은 초록 체크, 큐레이션·콘텐츠는 뮤트 텍스트(채운 배지 없음).
type BadgeTone = 'neutral' | 'brand' | 'ok' | 'fail' | 'warn' | 'purple'

// 엣지 출처 → UI 근거 표기(FITNESS_GRAPH §2.3). 근거 없는 추천은 서버가 내보내지 않는다.
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

// 공식(체크) / 그 외(뮤트 텍스트) — 색맹 안전을 위해 초록에는 항상 체크 아이콘을 붙인다.
function isVerifiedTone(tone: BadgeTone): boolean {
  return tone === 'ok' || tone === 'brand'
}

// 근거 한 줄 표기(배지 아님): ✓ 공단 공식 기준 / 전문가 큐레이션(검증 중)
function EvidenceNote({ label, tone }: { label: string; tone: BadgeTone }) {
  const verified = isVerifiedTone(tone)
  return (
    <span
      data-testid="source-badge"
      className={`inline-flex items-center gap-1 whitespace-nowrap text-[12px] ${
        verified ? 'text-ok dark:text-ok-dark' : 'text-mute dark:text-mute-dark'
      }`}
    >
      {verified && <CheckIcon className="w-3 h-3 shrink-0" />}
      {label}
    </span>
  )
}

function named(x: GraphNamed | string): { name: string; prov?: Provenance } {
  return typeof x === 'string' ? { name: x } : { name: x.name, prov: x.provenance }
}

// 멀티홉 표기(FITNESS_GRAPH §3.5): "via {goal}" 대신 한국어로. 경로 등급은 서버가 이미
// 두 홉 중 약한 쪽으로 내려 잡아 보냈다 — 화면은 그 사실을 바꾸지 않고 경유만 밝힌다.
function viaGoalLabel(prov?: Provenance): string | null {
  return prov?.via_goal ? `${prov.via_goal} 목적 경유` : null
}

// 기준 미달만 인주색 — 나머지 등급 라벨은 잉크(화면당 강조는 한두 군데).
function bandIsFail(band: string): boolean {
  return band.includes('미달')
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
  // C-4: 이 버튼의 숫자는 "종목 필터를 통과한 부분집합"이다. 옆 패널의 전체 카운트와
  // 나란히 놓여도 서로 반박하지 않도록 부분/전체를 한 문장에 같이 적는다(P-1).
  const counts = useMemo(
    // 종목 매칭은 lib/sports 1벌(2A) — 별칭 확장은 서버가 이미 끝냈다.
    () => countMatching([...nearby.voucher_facilities, ...nearby.alternatives], sports),
    [sports, nearby],
  )

  return (
    <section data-testid="fitness-result" aria-label="체력 판정 결과" className="flex flex-col">
      {/* ① 판정 머리: 명조 20px + 연령군, 그 아래 공식 기준·확인일 한 줄 */}
      <div className={SECTION_RULE}>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-serif text-[20px] font-extrabold text-ink dark:text-ink-dark">
            체력 판정
          </h3>
          {result.age_group && (
            <span className="text-[12px] text-mute dark:text-mute-dark">{result.age_group}</span>
          )}
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ok dark:text-ok-dark">
          <CheckIcon className="w-3 h-3 shrink-0" />
          국민체력100 공식 인증기준
          {result.basis_checked && (
            <span data-testid="fitness-basis-checked" className="text-mute dark:text-mute-dark">
              · 확인일 {result.basis_checked}
            </span>
          )}
        </p>

        {/* 항목별 등급 라벨 + 비교문 */}
        {items.length > 0 && (
          <>
            <ul className="mt-2.5">
              {items.map((it) => (
                <li
                  key={it.code}
                  data-testid="item-band"
                  className={`grid grid-cols-[92px_minmax(0,1fr)] items-baseline gap-x-2.5 py-2.5 ${ITEM_RULE}`}
                >
                  <span
                    className={`text-[12px] font-bold tracking-[0.04em] ${
                      bandIsFail(it.band)
                        ? 'text-accent-ink dark:text-accent-ink-dark'
                        : 'text-ink dark:text-ink-dark'
                    }`}
                  >
                    {it.band}
                  </span>
                  <span className="text-[14px] leading-[1.6] text-ink dark:text-ink-dark">
                    {it.comparison}
                  </span>
                </li>
              ))}
            </ul>
            {/* 파생값 출처(FR-07 AC8) — 어디서 온 숫자인지 숨기지 않는다(P-1) */}
            {(result.derived ?? []).map((d) => (
              <p
                key={d.code}
                data-testid={`derived-note-${d.code}`}
                className="mt-2 text-[12px] leading-[1.6] text-mute dark:text-mute-dark"
              >
                {d.code.toUpperCase()} {d.value}는 {Object.entries(d.from)
                  .map(([k, v]) => `${k === 'height_cm' ? '키' : k === 'weight_kg' ? '몸무게' : k} ${v}${k === 'height_cm' ? 'cm' : k === 'weight_kg' ? 'kg' : ''}`)
                  .join(' · ')}에서 계산한 값입니다({d.formula}).
              </p>
            ))}
          </>
        )}

        {/* ② 참고등급(추정) + 미입력 요인 + 인증센터 안내 */}
        {rg && (
          <div className={`mt-3 ${TINT_BOX}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] tracking-[0.1em] text-mute dark:text-mute-dark">
                {rg.label}
              </span>
              {rg.grade != null && (
                <span className="font-serif text-[17px] font-extrabold text-ink dark:text-ink-dark">
                  {rg.grade}등급 수준(추정)
                </span>
              )}
            </div>
            {rg.missing.length > 0 && (
              <p className="mt-1.5 text-[12.5px] leading-[1.55] text-mute dark:text-mute-dark">
                미입력 요인: {rg.missing.join(', ')} — 전 항목 측정 시에만 공식 등급이 확정됩니다.
              </p>
            )}
            <p className="mt-1 text-[12.5px] leading-[1.55] text-mute dark:text-mute-dark">
              자가입력 기준 추정값입니다. <b className="text-ink dark:text-ink-dark">공식 인증은 체력인증센터(무료)</b>에서 받을 수 있습니다.
            </p>
          </div>
        )}
      </div>

      {/* ③ 약점별 추천 (근거 표기 + 영상 카드) */}
      <div className={`mt-5 ${SECTION_RULE}`}>
        {result.recommendations.length > 0 ? (
          <>
            <h4 className="font-serif text-[22px] font-extrabold leading-[1.35] text-ink dark:text-ink-dark">
              약점별 추천
            </h4>
            <p className="mt-1.5 text-[13px] leading-[1.6] text-mute dark:text-mute-dark">
              근거 등급을 숨기지 않아요 — 검증 중인 큐레이션은 그대로 "검증 중"이라고 적습니다.
            </p>
            {result.recommendations.map((r, i) => (
              <RecommendationBlock key={i} rec={r} />
            ))}
          </>
        ) : (
          result.weaknesses.length === 0 && (
            <p className="flex items-start gap-1.5 text-[13.5px] leading-[1.6] text-ok dark:text-ok-dark">
              <CheckIcon className="mt-0.5 w-4 h-4 shrink-0" />
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
            className="press mt-4 flex min-h-[48px] w-full items-center justify-center rounded-[3px] bg-ink px-4 py-2 text-center font-serif text-[15px] font-extrabold text-paper transition-opacity hover:opacity-90 dark:bg-ink-dark dark:text-paper-dark"
          >
            <span>
              이 운동 되는 근처 강좌 보기 · {sports.join(' · ')}
              <span data-testid="facility-filter-count" className="ml-1 font-sans text-[13px] font-normal">
                ({nearbyMatchText(counts)})
              </span>
            </span>
          </button>
        )}
      </div>

      {/* ⑤ AI 처방 — 진행 문구("최대 1분") + 취소, 실패 시(429 등) 정직한 안내 */}
      {showAi && (
        <div className="mt-4 flex flex-col gap-2">
          {!aiLoading && (
            <button type="button" data-testid="ai-prescribe-btn" onClick={onRequestAi} className={BTN_LINE}>
              {ai || aiError ? 'AI 처방 다시 받기' : 'AI 처방 받기'}
            </button>
          )}
          {aiLoading && (
            <div
              role="status"
              data-testid="ai-progress"
              className={`flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink dark:text-ink-dark ${TINT_BOX}`}
            >
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-rule border-t-ink dark:border-rule-dark dark:border-t-ink-dark"
                />
                처방 문장을 만드는 중 — 최대 1분
              </span>
              <button type="button" data-testid="ai-cancel" onClick={onCancelAi} className={BTN_TEXT}>
                취소
              </button>
            </div>
          )}
          {aiError && !aiLoading && (
            <p
              role="alert"
              data-testid="ai-error"
              className="flex items-start gap-1.5 rounded-[3px] border border-rule p-3 text-[13px] leading-[1.6] text-ink dark:border-rule-dark dark:text-ink-dark"
            >
              <WarnIcon className="mt-0.5 w-4 h-4 shrink-0 text-accent-ink dark:text-accent-ink-dark" />
              {aiError.kind === 'ratelimit'
                ? aiError.message
                : 'AI 처방을 불러오지 못했어요. 위 규칙 기반 추천을 참고하시고, 잠시 후 다시 시도해 주세요.'}
            </p>
          )}
          {ai && <AiResult ai={ai} />}
        </div>
      )}

      {/* 하단 고정 고지(FR-08 AC5) */}
      <p
        className={`mt-4 pt-2.5 text-[12px] leading-[1.6] text-mute dark:text-mute-dark ${ROW_RULE}`}
      >
        {FITNESS_DISCLAIMER}
      </p>
    </section>
  )
}

function RecommendationBlock({ rec }: { rec: FitnessRecommendation }) {
  const exercises = (rec.exercises as (GraphNamed | string)[]).map(named)
  const sports = ((rec.sports ?? []) as (GraphNamed | string)[]).map(named)
  const videos = (rec.videos ?? []) as GraphVideo[]
  // C-5: 카드에 찍히는 이름은 소스의 변형 번호("-1")를 뗀 표시명. 원문은 alt·data 속성에 남는다.
  // 꼬리를 떼서 이름이 겹치면 "(2)"로 되살려 두 카드가 같은 이름이 되지 않게 한다.
  const shownVideos = videos.slice(0, 3)
  const videoNames = dedupeDisplayTitles(shownVideos.map((v) => v.title))
  // 그래프가 이 요인에 아무것도 잇지 못한 경우(예: 고아 요인) — 빈 블록을 조용히 남기지 않고
  // 근거가 없다고 말한다(P-1). 없는 추천을 지어내지 않는다.
  const empty = exercises.length === 0 && sports.length === 0 && videos.length === 0
  return (
    <div data-testid="rec-block" className="mt-4">
      <p className="font-serif text-[18px] font-extrabold text-accent-ink dark:text-accent-ink-dark">
        {rec.weakness}
      </p>

      {empty && (
        <p
          data-testid="rec-empty"
          className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-[1.6] text-mute dark:text-mute-dark"
        >
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
          이 요인에 연결된 그래프 근거가 아직 없습니다 — 근거 없는 추천은 만들지 않습니다.
        </p>
      )}

      {exercises.length > 0 && (
        <ul className="mt-2">
          {exercises.map((e, i) => {
            const badge = sourceBadge(e.prov)
            const via = viaGoalLabel(e.prov)
            return (
              <li
                key={i}
                className={`flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 py-2 ${ITEM_RULE}`}
              >
                <span className="text-[15px] font-bold text-ink dark:text-ink-dark">{e.name}</span>
                <span className="flex flex-wrap items-center gap-x-2">
                  {badge && <EvidenceNote label={badge.label} tone={badge.tone} />}
                  {via && (
                    <span
                      data-testid="rec-via-goal"
                      className="text-[12px] text-mute dark:text-mute-dark"
                    >
                      {via}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {/* 연결 종목 — 필터 버튼에는 이름만 남지만, 검증 상태는 여기서 그대로 보인다(P-1).
          B티어(유도·주짓수 등)가 "전문가 큐레이션(검증 중)" 인 사실을 화면에서 감추지 않는다. */}
      {sports.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[12px] tracking-[0.12em] text-mute dark:text-mute-dark">연결 종목</p>
          <ul data-testid="rec-sports">
            {sports.map((s, i) => {
              const badge = sourceBadge(s.prov)
              return (
                <li
                  key={i}
                  data-testid="rec-sport"
                  className={`flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 py-2 ${ITEM_RULE}`}
                >
                  <span className="text-[14px] text-ink dark:text-ink-dark">{s.name}</span>
                  {badge && <EvidenceNote label={badge.label} tone={badge.tone} />}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {shownVideos.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2.5">
          {shownVideos.map((v, i) => (
            <li key={i} data-testid="video-card" data-raw-title={v.title} className="min-w-0">
              <a href={v.url ?? '#'} target="_blank" rel="noreferrer noopener" title={v.title} className="block">
                {/* 썸네일 alt 는 원천 제목 그대로 — 표시용 다듬기는 화면 문자열에만 적용한다 */}
                <VideoThumb src={v.img_url} title={v.title} />
                <span className="mt-1.5 block text-[13px] leading-[1.35] font-bold text-ink underline decoration-1 underline-offset-2 dark:text-ink-dark">
                  {videoNames[i]}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// 썸네일(CQ4A): 조립된 https URL 이 죽어 있어도 깨진 아이콘을 보여 주지 않는다 —
// onError 면 자리표시 블록으로 바꾸고 제목 링크는 그대로 살린다.
function VideoThumb({ src, title }: { src?: string | null; title: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div
        data-testid="video-thumb-fallback"
        className="grid aspect-video w-full place-items-center rounded-[3px] border border-rule bg-tint text-ink dark:border-rule-dark dark:bg-tint-dark dark:text-ink-dark"
      >
        <PlayIcon className="h-5 w-5" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={title}
      onError={() => setFailed(true)}
      className="aspect-video w-full rounded-[3px] border border-rule object-cover dark:border-rule-dark"
    />
  )
}

// provider 정직 라벨(FR-08 AC3) — AI가 아니면 "기본 규칙 처방"이라고 그대로 말한다.
function AiResult({ ai }: { ai: FitnessAiResponse }) {
  const isAi = ai.provider === 'claude' || ai.provider === 'gemini'
  return (
    <div data-testid="ai-result" className={`mt-2 ${TINT_BOX}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span
          data-testid="ai-provider-label"
          className="font-serif text-[16px] font-extrabold text-ink dark:text-ink-dark"
        >
          {isAi ? 'AI 보조 처방' : '기본 규칙 처방'}
        </span>
        <span className="text-[12px] text-mute dark:text-mute-dark">provider: {ai.provider}</span>
      </div>

      {ai.처방.length > 0 && (
        <ul className="mt-1">
          {ai.처방.map((rx, i) => (
            <li key={i} data-testid="ai-rx" className={`py-2.5 ${ITEM_RULE}`}>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[15px] font-bold text-ink dark:text-ink-dark">{rx.운동}</span>
                <span className="text-[12px] text-mute dark:text-mute-dark">{rx.목표체력요인}</span>
              </p>
              <p className="mt-1 text-[12.5px] leading-[1.6] text-mute dark:text-mute-dark">
                강도: {rx.강도} · 빈도: {rx.주당빈도}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[12px] leading-[1.6] text-mute dark:text-mute-dark">{ai.주의}</p>
    </div>
  )
}


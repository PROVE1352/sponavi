import type { PathEdge } from '../types'
import { curatedLabel, edgeWidth, type EdgeWidth } from '../lib/pathLabel'
import { Badge, CheckIcon, KeepDates, SECTION_RULE, WarnIcon, XIcon } from './ui'

// path 배열을 가로 스텝 다이어그램으로: 개인 → 제도(✗) → 대안 → 시설
// 엣지 라벨·✓/✗ 색. 대체경로 확인 표기: "공식 확인(…)"은 초록 체크 그대로,
// 그 밖(검증 대기)은 "전문가 큐레이션" 뱃지 (SPEC §0-3, §0-4 · lib/pathLabel).
//
// 폭(2026-09-28): 긴 엣지 설명·확인 표기가 80px 칸에 갇혀 글자 단위로 줄이 바뀌던 문제 →
//   · 모바일(가로 스크롤): 대체경로(확인 표기) 칸 192px, 보통 128px, 짧은 96px 고정
//   · sm 이상: 목록이 스트림 폭을 채우고 엣지 칸이 남는 폭을 나눠 갖는다(3 : 1.5 : 1)
//   · 한국어는 어절 단위로만 줄바꿈(word-break: keep-all)

function nodeLabel(id: string): { title: string; sub?: string } {
  if (id === 'person') return { title: '나', sub: '입력한 상황' }
  if (id === 'svoucher') return { title: '스포츠강좌이용권' }
  if (id === 'dvoucher') return { title: '장애인 이용권' }
  if (id === 'public_program') return { title: '공공 프로그램', sub: '구립·군립 시설' }
  // 장소가 없는 제도 — 경로는 여기서 끝난다(시설 홉을 잇지 않는다, 서버 _PLACE_BASED_PROGRAMS).
  if (id === 'tteuntteun') return { title: '튼튼머니', sub: '포인트 적립' }
  if (id === 'culture_deduction') return { title: '문화비 소득공제', sub: '연말정산' }
  if (id === 'senior_voucher') return { title: '어르신 상품권', sub: '기초연금 수급' }
  if (id === 'senior_free_class') return { title: '어르신 무료강좌', sub: '65세+' }
  if (id.startsWith('facility:')) return { title: '시설 연결', sub: '근처 자원' }
  return { title: id }
}

interface Node {
  id: string
  status: 'start' | 'ok' | 'fail'
  incoming?: PathEdge
}

export function PathDiagram({ path }: { path: PathEdge[] }) {
  if (path.length === 0) return null
  const nodes: Node[] = [{ id: path[0].from, status: 'start' }]
  for (const e of path) nodes.push({ id: e.to, status: e.result, incoming: e })

  return (
    <section aria-label="추천 경로 시각화" className={SECTION_RULE}>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="font-serif text-[18px] font-extrabold text-ink dark:text-ink-dark">
          왜 이 결과인가 · 경로
        </h2>
      </div>
      <p className="mb-4 text-[13px] leading-[1.65] text-mute dark:text-mute-dark">
        개인 상황에서 제도·대안을 거쳐 실제 시설까지 이어지는 경로입니다.
      </p>

      <div className="relative">
        <div
          className="overflow-x-auto pb-2"
          tabIndex={0}
          role="group"
          aria-label="경로 단계 (좌우로 스크롤)"
        >
          <ol className="flex min-w-max items-stretch gap-1 sm:min-w-0 sm:w-full">
            {nodes.map((n, i) => {
              const edge = i < nodes.length - 1 ? nodes[i + 1].incoming! : null
              const grow = edge ? GROW[edgeWidth(edge.label, edge.curated)] : 'shrink-0'
              return (
                <li key={i} className={`flex items-stretch ${grow}`}>
                  <NodeBox node={n} />
                  {edge && <EdgeArrow edge={edge} />}
                </li>
              )
            })}
          </ol>
        </div>
        {/* 오른쪽 스크롤 힌트(모바일에서 다음 스텝이 있음을 알림) */}
        {nodes.length > 2 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-0 top-0 h-full w-10 bg-gradient-to-l from-paper to-transparent dark:from-paper-dark sm:hidden"
          />
        )}
      </div>
      {nodes.length > 2 && (
        <p className="mt-1 text-center text-[12px] text-mute dark:text-mute-dark sm:hidden">
          ← 좌우로 넘겨 전체 경로를 확인하세요 →
        </p>
      )}
    </section>
  )
}

function NodeBox({ node }: { node: Node }) {
  const { title, sub } = nodeLabel(node.id)
  const styles =
    node.status === 'fail'
      ? 'border-accent-ink dark:border-accent-ink-dark'
      : 'border-rule dark:border-rule-dark'
  return (
    // 폭: 제도명은 공식 명칭 그대로(가짜 띄어쓰기 금지) — 칸이 글자에 맞춰 넓어진다(최소 96px, sm 이상 80px — 남는 폭은 대체경로 칸 몫).
    //   "스포츠강좌이용권"이 "스포츠강좌이 / 용권"으로 쪼개지던 문제(2026-09-28 PC 스샷) → overflow-wrap:anywhere 제거,
    //   띄어쓰기가 있는 이름("문화비 소득공제")만 어절 단위로 접힌다.
    <div className={`flex w-max min-w-24 max-w-[10rem] shrink-0 sm:min-w-20 flex-col items-center justify-center rounded-[3px] border px-2.5 py-3 text-center break-keep ${styles}`}>
      <div className="mb-1" aria-hidden="true">
        {node.status === 'ok' && <CheckIcon className="w-5 h-5 text-ok dark:text-ok-dark" />}
        {node.status === 'fail' && (
          <XIcon className="w-5 h-5 text-accent-ink dark:text-accent-ink-dark" />
        )}
        {node.status === 'start' && (
          <span className="inline-block h-4 w-4 bg-ink dark:bg-ink-dark" aria-hidden="true" />
        )}
      </div>
      <div className="text-[13px] font-bold leading-tight text-ink dark:text-ink-dark">
        {/* 상태 접두는 제목과 같은 줄에 — 스크린리더·텍스트 추출이 "충족: 공공 프로그램"으로 읽는다
            (값 없는 "충족:" 한 줄 금지). sr-only(absolute)는 블록으로 떨어져 줄이 갈리므로 인라인 블록 숨김을 쓴다. */}
        <span className="-m-px inline-block h-px w-px overflow-hidden whitespace-nowrap [clip-path:inset(50%)]">
          {node.status === 'ok' ? '충족:\u00a0' : node.status === 'fail' ? '미충족:\u00a0' : '시작:\u00a0'}
        </span>
        {title}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-mute dark:text-mute-dark">{sub}</div>}
    </div>
  )
}

// sm 이상에서 남는 폭을 나눠 갖는 비율(li = 노드 + 뒤따르는 엣지).
const GROW: Record<EdgeWidth, string> = {
  wide: 'sm:flex-[3_1_0%]',
  medium: 'sm:flex-[1.5_1_0%]',
  narrow: 'sm:flex-[1_1_0%]',
}
// 모바일(가로 스크롤) 고정 폭.
const MOBILE_W: Record<EdgeWidth, string> = { wide: 'w-48', medium: 'w-32', narrow: 'w-24' }

function EdgeArrow({ edge }: { edge: PathEdge }) {
  const ok = edge.result === 'ok'
  const line = ok ? 'bg-ok dark:bg-ok-dark' : 'bg-accent-ink dark:bg-accent-ink-dark'
  const arrow = ok ? 'text-ok dark:text-ok-dark' : 'text-accent-ink dark:text-accent-ink-dark'
  const width = edgeWidth(edge.label, edge.curated)
  const cur = curatedLabel(edge.curated)
  return (
    <div
      data-testid="path-edge"
      className={`flex shrink-0 flex-col items-center justify-center px-1.5 break-keep [overflow-wrap:anywhere] ${MOBILE_W[width]} sm:w-auto sm:min-w-24 sm:flex-1`}
    >
      <div className="mb-1 text-center text-[11px] font-bold text-mute dark:text-mute-dark">{edge.edge}</div>
      <div className="flex w-full items-center">
        <span className={`h-0.5 flex-1 ${line}`} />
        <svg viewBox="0 0 20 20" fill="currentColor" className={`h-4 w-4 shrink-0 ${arrow}`} aria-hidden="true">
          <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div
        data-testid="path-edge-label"
        className="mt-1 max-w-full text-center text-[11px] leading-[1.45] text-mute dark:text-mute-dark"
      >
        <KeepDates text={edge.label} />
      </div>
      {cur && (
        <div data-testid="path-edge-curated" className="mt-1.5 max-w-full text-center">
          {cur.official ? (
            // OkNote 와 같은 표기(초록 체크 + 작은 글자)지만 칸 안에서 어절 단위로 접힐 수 있게.
            <span className="inline-flex items-start gap-1 text-left text-[11.5px] leading-[1.5] text-ok dark:text-ok-dark">
              <CheckIcon className="mt-[3px] h-3 w-3 shrink-0" />
              <span>
                <KeepDates text={cur.text} />
              </span>
            </span>
          ) : (
            <Badge icon={<WarnIcon className="h-3 w-3 shrink-0" />}>
              <span className="text-left">
                <KeepDates text={cur.text} />
              </span>
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}

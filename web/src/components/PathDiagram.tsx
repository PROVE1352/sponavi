import type { PathEdge } from '../types'
import { Badge, CheckIcon, SECTION_RULE, WarnIcon, XIcon } from './ui'

// path 배열을 가로 스텝 다이어그램으로: 개인 → 제도(✗) → 대안 → 시설
// 엣지 라벨·✓/✗ 색, curated 엣지엔 "전문가 큐레이션" 뱃지 (SPEC §0-3, §0-4).

function nodeLabel(id: string): { title: string; sub?: string } {
  if (id === 'person') return { title: '나', sub: '입력한 상황' }
  if (id === 'svoucher') return { title: '스포츠강좌이용권' }
  if (id === 'dvoucher') return { title: '장애인 이용권' }
  if (id === 'public_program') return { title: '공공 프로그램', sub: '무료/저가' }
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
          <ol className="flex min-w-max items-stretch gap-1">
            {nodes.map((n, i) => (
              <li key={i} className="flex items-stretch">
                <NodeBox node={n} />
                {i < nodes.length - 1 && <EdgeArrow edge={nodes[i + 1].incoming!} />}
              </li>
            ))}
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
    <div className={`flex w-24 flex-col items-center justify-center rounded-[3px] border px-2 py-3 text-center ${styles}`}>
      <div className="mb-1">
        <span className="sr-only">
          {node.status === 'ok' ? '충족: ' : node.status === 'fail' ? '미충족: ' : '시작: '}
        </span>
        {node.status === 'ok' && <CheckIcon className="w-5 h-5 text-ok dark:text-ok-dark" />}
        {node.status === 'fail' && (
          <XIcon className="w-5 h-5 text-accent-ink dark:text-accent-ink-dark" />
        )}
        {node.status === 'start' && (
          <span className="inline-block h-4 w-4 bg-ink dark:bg-ink-dark" aria-hidden="true" />
        )}
      </div>
      <div className="text-[13px] font-bold leading-tight text-ink dark:text-ink-dark">{title}</div>
      {sub && <div className="mt-0.5 text-[11px] text-mute dark:text-mute-dark">{sub}</div>}
    </div>
  )
}

function EdgeArrow({ edge }: { edge: PathEdge }) {
  const ok = edge.result === 'ok'
  const line = ok ? 'bg-ok dark:bg-ok-dark' : 'bg-accent-ink dark:bg-accent-ink-dark'
  const arrow = ok ? 'text-ok dark:text-ok-dark' : 'text-accent-ink dark:text-accent-ink-dark'
  return (
    <div className="flex w-20 flex-col items-center justify-center px-1">
      <div className="mb-1 text-center text-[11px] font-bold text-mute dark:text-mute-dark">{edge.edge}</div>
      <div className="flex w-full items-center">
        <span className={`h-0.5 flex-1 ${line}`} />
        <svg viewBox="0 0 20 20" fill="currentColor" className={`h-4 w-4 ${arrow}`} aria-hidden="true">
          <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="mt-1 text-center text-[11px] leading-tight text-mute dark:text-mute-dark">{edge.label}</div>
      {edge.curated && (
        <div className="mt-1.5">
          <Badge icon={<WarnIcon className="w-3 h-3" />}>
            전문가 큐레이션 · {edge.curated}
          </Badge>
        </div>
      )}
    </div>
  )
}

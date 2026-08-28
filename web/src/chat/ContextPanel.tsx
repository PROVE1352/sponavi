// 컨텍스트 패널: 데스크톱(lg) 우측 고정 컬럼 · 모바일 상단 접이식 시트.
// 지도(MapLibre GL)는 여기 단 하나만 상주한다(메시지별 재마운트 금지, ARCHITECTURE §11.4).
// 패널이 없어도 스트림만으로 정보가 완결되므로(FR-12 AC3), 여기는 "더 크게 보는 곳"이다.

import { useId } from 'react'
import type { RefObject } from 'react'
import type { AssessRequest, AssessResponse } from '../types'
import type { PanelTab } from '../types_chat'
import { NearbyMap } from '../components/NearbyMap'
import { NearbyList } from '../components/NearbyList'
import { Badge } from '../components/ui'
import { countMatching, poolCountText } from '../lib/sports'
import { facilityCountText } from './messages'
import { personLocOf } from './policy'

export function ContextPanel({
  req,
  data,
  open,
  tab,
  filterSports,
  anchorRef,
  onToggle,
  onTab,
  onClearFilter,
}: {
  req: AssessRequest
  data: AssessResponse
  open: boolean
  tab: PanelTab
  filterSports?: string[]
  // 셸이 "패널로 데려가기"를 할 때 위치를 재는 앵커(v1.7).
  anchorRef?: RefObject<HTMLDivElement | null>
  onToggle: (open: boolean) => void
  onTab: (tab: PanelTab) => void
  onClearFilter: () => void
}) {
  const baseId = useId()
  const mapPanelId = `${baseId}-map`
  const listPanelId = `${baseId}-list`
  // C-4: 아래 목록이 종목 필터로 줄어 있으면 배지도 그 사실을 함께 말한다 —
  // 필터 걸린 목록 위에 전체 수만 떠 있으면 두 숫자가 서로 반박하는 것처럼 읽힌다(P-1).
  const altCounts = countMatching(data.nearby.alternatives, filterSports)

  return (
    <aside
      data-testid="context-panel"
      aria-label="근처 자원 패널"
      className="order-1 w-full min-w-0 lg:order-2 lg:sticky lg:top-[4.5rem] lg:w-[38%] lg:shrink-0"
    >
      <div
        ref={anchorRef}
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900"
      >
        {/* 요약 바 — 모바일에서는 접힘 상태의 존재감, 데스크톱에서는 헤더 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold text-slate-900 dark:text-white">근처 자원</span>
            {/* FR-04 AC6: 잘린 목록 길이를 구 단위 카운트인 척 쓰지 않는다(요약 바도 같은 문구) */}
            <Badge tone="brand">{facilityCountText(req, data)}</Badge>
            <Badge tone="ok">
              <span data-testid="panel-alt-count">{poolCountText('공공·대안', altCounts)}</span>
            </Badge>
          </div>
          <button
            type="button"
            data-testid="panel-toggle"
            onClick={() => onToggle(!open)}
            aria-expanded={open}
            aria-controls={`${baseId}-body`}
            className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-slate-300 px-4 text-xs font-semibold text-slate-700 transition-colors duration-200 ease-out hover:border-slate-400 hover:bg-slate-100 lg:hidden dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          >
            {open ? '접기' : '지도·목록 펼치기'}
          </button>
        </div>

        {/* 본문 — 모바일은 접힘 가능, 데스크톱(lg)은 상시 표시.
            나타날 때만 위에서 아래로 슬라이드(sheet-slide-down, 240ms ease-out).
            접힘은 display:none 이라 애니메이션 없이 즉시 사라진다 —
            숨김을 transform 으로 흉내내지 않으므로 접힌 본문은 포커스·낭독 대상에서도 빠진다. */}
        <div
          id={`${baseId}-body`}
          data-testid="panel-body"
          className={open ? 'sheet-slide-down block' : 'hidden lg:block'}
        >
          <div role="tablist" aria-label="패널 보기 전환" className="flex gap-1 px-3 pt-3">
            <button
              type="button"
              role="tab"
              id={`${mapPanelId}-tab`}
              aria-selected={tab === 'map'}
              aria-controls={mapPanelId}
              data-testid="panel-tab-map"
              onClick={() => onTab('map')}
              className={
                'min-h-11 flex-1 rounded-full px-3 text-sm font-semibold transition-colors duration-200 ease-out ' +
                (tab === 'map'
                  ? 'bg-brand-600 text-white'
                  : 'border-[1.5px] border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800')
              }
            >
              지도
            </button>
            <button
              type="button"
              role="tab"
              id={`${listPanelId}-tab`}
              aria-selected={tab === 'list'}
              aria-controls={listPanelId}
              data-testid="panel-tab-list"
              onClick={() => onTab('list')}
              className={
                'min-h-11 flex-1 rounded-full px-3 text-sm font-semibold transition-colors duration-200 ease-out ' +
                (tab === 'list'
                  ? 'bg-brand-600 text-white'
                  : 'border-[1.5px] border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800')
              }
            >
              시설 목록
            </button>
          </div>

          {/* 지도 패널: 언마운트하지 않는다(1인스턴스 유지) — 숨김만 한다 */}
          <div
            role="tabpanel"
            id={mapPanelId}
            aria-labelledby={`${mapPanelId}-tab`}
            hidden={tab !== 'map'}
            className="p-3"
          >
            <NearbyMap personLoc={personLocOf(req)} nearby={data.nearby} />
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
              지도 없이도 같은 정보를 시설 목록과 대화 카드에서 확인하실 수 있어요.
            </p>
          </div>

          <div
            role="tabpanel"
            id={listPanelId}
            aria-labelledby={`${listPanelId}-tab`}
            hidden={tab !== 'list'}
            className="max-h-[70dvh] overflow-y-auto p-3 lg:max-h-[calc(100dvh-16rem)]"
          >
            <NearbyList
              nearby={data.nearby}
              filterSports={filterSports}
              onClearFilter={onClearFilter}
            />
          </div>
        </div>
      </div>
    </aside>
  )
}

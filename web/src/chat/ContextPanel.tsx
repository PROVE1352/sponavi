// 컨텍스트 패널: 데스크톱(lg) 우측 고정 컬럼 · 모바일 상단 접이식 시트.
// Leaflet 은 여기 단 하나만 상주한다(메시지별 재마운트 금지, ARCHITECTURE §11.4).
// 패널이 없어도 스트림만으로 정보가 완결되므로(FR-12 AC3), 여기는 "더 크게 보는 곳"이다.

import { useId } from 'react'
import type { AssessRequest, AssessResponse } from '../types'
import type { PanelTab } from '../types_chat'
import { NearbyMap } from '../components/NearbyMap'
import { NearbyList } from '../components/NearbyList'
import { Badge } from '../components/ui'
import { personLocOf } from './policy'

export function ContextPanel({
  req,
  data,
  open,
  tab,
  filterSports,
  onToggle,
  onTab,
  onClearFilter,
}: {
  req: AssessRequest
  data: AssessResponse
  open: boolean
  tab: PanelTab
  filterSports?: string[]
  onToggle: (open: boolean) => void
  onTab: (tab: PanelTab) => void
  onClearFilter: () => void
}) {
  const baseId = useId()
  const mapPanelId = `${baseId}-map`
  const listPanelId = `${baseId}-list`
  const vCount = data.nearby.voucher_facilities.length
  const aCount = data.nearby.alternatives.length

  return (
    <aside
      data-testid="context-panel"
      aria-label="근처 자원 패널"
      className="order-1 w-full min-w-0 lg:order-2 lg:sticky lg:top-[4.5rem] lg:w-[38%] lg:shrink-0"
    >
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
        {/* 요약 바 — 모바일에서는 접힘 상태의 존재감, 데스크톱에서는 헤더 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold text-slate-900 dark:text-white">근처 자원</span>
            <Badge tone="brand">
              {req.sigungu_nm} 가맹 {vCount}곳
            </Badge>
            <Badge tone="ok">공공·대안 {aCount}곳</Badge>
          </div>
          <button
            type="button"
            data-testid="panel-toggle"
            onClick={() => onToggle(!open)}
            aria-expanded={open}
            aria-controls={`${baseId}-body`}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 lg:hidden dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {open ? '접기' : '지도·목록 펼치기'}
          </button>
        </div>

        {/* 본문 — 모바일은 접힘 가능, 데스크톱(lg)은 상시 표시 */}
        <div id={`${baseId}-body`} className={open ? 'block' : 'hidden lg:block'}>
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
                'min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition ' +
                (tab === 'map'
                  ? 'bg-brand-600 text-white'
                  : 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800')
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
                'min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition ' +
                (tab === 'list'
                  ? 'bg-brand-600 text-white'
                  : 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800')
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

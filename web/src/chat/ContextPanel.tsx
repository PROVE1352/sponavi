// 컨텍스트 패널: 데스크톱(lg) 우측 고정 컬럼 · 모바일 상단 접이식 시트.
// 지도(MapLibre GL)는 여기 단 하나만 상주한다(메시지별 재마운트 금지, ARCHITECTURE §11.4).
// 패널이 없어도 스트림만으로 정보가 완결되므로(FR-12 AC3), 여기는 "더 크게 보는 곳"이다.

import { useCallback, useId, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import type { AssessRequest, AssessResponse } from '../types'
import type { PanelTab } from '../types_chat'
import { NearbyMap, type MapLocate } from '../components/NearbyMap'
import { NearbyList } from '../components/NearbyList'
import type { FacilitySearchScope, SearchMapPoint } from '../types_search'
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
  locate,
  onLocate,
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
  // 시설 목록 → 지도 확대(요청 1건당 seq 1 증가).
  locate?: MapLocate | null
  onLocate?: (id: string) => void
}) {
  const baseId = useId()
  const mapPanelId = `${baseId}-map`
  const listPanelId = `${baseId}-list`
  // C-4: 아래 목록이 종목 필터로 줄어 있으면 배지도 그 사실을 함께 말한다 —
  // 필터 걸린 목록 위에 전체 수만 떠 있으면 두 숫자가 서로 반박하는 것처럼 읽힌다(P-1).
  const altCounts = countMatching(data.nearby.alternatives, filterSports)
  // 동·도로명·시설명 검색(현재 결과의 시군구 안). 실좌표 결과만 지도에 얹는다.
  const [searchPoints, setSearchPoints] = useState<SearchMapPoint[]>([])
  // 빈 배열 → 빈 배열은 상태를 바꾸지 않는다(지도 마커를 괜히 다시 그리지 않게).
  const onSearchHits = useCallback(
    (pts: SearchMapPoint[]) =>
      setSearchPoints((prev) => (prev.length === 0 && pts.length === 0 ? prev : pts)),
    [],
  )
  const searchScope = useMemo<FacilitySearchScope | undefined>(
    () =>
      req.sigungu_cd
        ? {
            sigungu_cd: req.sigungu_cd,
            sigungu_nm: req.sigungu_nm,
            voucherProgram: req.disability.has ? 'dvoucher' : 'svoucher',
            origin: req.location ?? null,
            age: req.age,
          }
        : undefined,
    [req],
  )

  return (
    <aside
      data-testid="context-panel"
      aria-label="근처 자원 패널"
      className="order-1 w-full min-w-0 lg:order-2 lg:sticky lg:top-[4.5rem] lg:w-[38%] lg:shrink-0"
    >
      <div
        ref={anchorRef}
        className="border-t-2 border-ink bg-paper dark:border-ink-dark dark:bg-paper-dark"
      >
        {/* 요약 바 — 모바일에서는 접힘 상태의 존재감, 데스크톱에서는 헤더 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule py-2.5 dark:border-rule-dark">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="font-serif text-[16px] font-extrabold text-ink dark:text-ink-dark">근처 자원</span>
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
            className="press inline-flex min-h-11 items-center bg-transparent text-[13px] text-mute underline decoration-1 underline-offset-4 hover:text-ink lg:hidden dark:text-mute-dark dark:hover:text-ink-dark"
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
          <div role="tablist" aria-label="패널 보기 전환" className="flex gap-5 pt-3">
            <button
              type="button"
              role="tab"
              id={`${mapPanelId}-tab`}
              aria-selected={tab === 'map'}
              aria-controls={mapPanelId}
              data-testid="panel-tab-map"
              onClick={() => onTab('map')}
              className={
                'font-serif min-h-11 bg-transparent px-0.5 text-[16px] font-extrabold ' +
                (tab === 'map'
                  ? 'border-b-[2.5px] border-ink text-ink dark:border-ink-dark dark:text-ink-dark'
                  : 'border-b-[2.5px] border-transparent text-mute hover:text-ink dark:text-mute-dark dark:hover:text-ink-dark')
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
                'font-serif min-h-11 bg-transparent px-0.5 text-[16px] font-extrabold ' +
                (tab === 'list'
                  ? 'border-b-[2.5px] border-ink text-ink dark:border-ink-dark dark:text-ink-dark'
                  : 'border-b-[2.5px] border-transparent text-mute hover:text-ink dark:text-mute-dark dark:hover:text-ink-dark')
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
            className="py-3"
          >
            <NearbyMap
              personLoc={personLocOf(req)}
              nearby={data.nearby}
              locate={locate}
              extraPoints={searchPoints}
            />
            <p className="mt-2 text-xs text-mute dark:text-mute-dark">
              지도 없이도 같은 정보를 시설 목록과 대화 카드에서 확인하실 수 있어요.
            </p>
          </div>

          <div
            role="tabpanel"
            id={listPanelId}
            aria-labelledby={`${listPanelId}-tab`}
            hidden={tab !== 'list'}
            className="max-h-[70dvh] overflow-y-auto py-3 lg:max-h-[calc(100dvh-16rem)]"
          >
            <NearbyList
              nearby={data.nearby}
              filterSports={filterSports}
              onClearFilter={onClearFilter}
              onLocate={onLocate}
              search={searchScope}
              onSearchHits={onSearchHits}
            />
          </div>
        </div>
      </div>
    </aside>
  )
}

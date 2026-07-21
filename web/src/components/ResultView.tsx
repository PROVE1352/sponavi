import { useState } from 'react'
import type { AssessRequest, AssessResponse } from '../types'
import { EligibilityCard } from './EligibilityCard'
import { PathDiagram } from './PathDiagram'
import { SupplyGapBanner } from './SupplyGapBanner'
import { NearbyMap } from './NearbyMap'
import { NearbyList } from './NearbyList'
import { FitnessStep } from './FitnessStep'

// 결과 화면 3블록: (a) 자격 카드들 (b) 경로 시각화 (c) 근처 자원(지도+리스트) + 공급공백 배너 + 체력처방.
export function ResultView({ req, data }: { req: AssessRequest; data: AssessResponse }) {
  const [filterSports, setFilterSports] = useState<string[] | undefined>(undefined)

  const personLoc = req.location ?? { lat: 37.5665, lon: 126.978 }
  // alt_edges(복수 대체경로)는 주 제도(비장애=svoucher / 장애=dvoucher)에 귀속 → 해당 카드에만 전달.
  const primaryId = req.disability.has ? 'dvoucher' : 'svoucher'

  return (
    <div className="space-y-6">
      {/* (b) 경로 시각화 — "왜 이 결과인가" 3분 체감 */}
      <PathDiagram path={data.path} />

      {/* (a) 자격 카드들 */}
      <section aria-label="예상 자격" className="space-y-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">제도별 예상 자격</h2>
        <div className="grid gap-3 lg:grid-cols-3">
          {data.eligibility.map((p) => (
            <EligibilityCard
              key={p.program_id}
              p={p}
              altEdges={p.program_id === primaryId ? data.alt_edges : undefined}
            />
          ))}
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          ※ 여기 표시된 것은 <b>예상 자격</b>입니다. 최종 자격은 각 공식 신청처에서 확인됩니다.
        </p>
      </section>

      {/* (c) 근처 자원 — 공급공백 배너 + 지도 + 리스트 */}
      <section aria-label="근처 자원과 공급공백" className="space-y-4">
        <SupplyGapBanner gap={data.supply_gap} />
        <NearbyMap personLoc={personLoc} nearby={data.nearby} />
        <NearbyList
          nearby={data.nearby}
          filterSports={filterSports}
          onClearFilter={() => setFilterSports(undefined)}
        />
      </section>

      {/* 체력 처방 (선택) — 필터 연동 */}
      <FitnessStep
        age={req.age}
        sex={req.sex}
        nearby={data.nearby}
        onApplyFilter={(s) => setFilterSports(s)}
      />
    </div>
  )
}

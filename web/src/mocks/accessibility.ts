// 목-모드 접근성 응답(FR-10). 서버 없이 GET /api/accessibility 를 흉내낸다.
// 데모 페르소나 P3(지체장애)의 dvoucher 시설 'D01'(서울장애인체육관, mocks/personas.ts)에
// 접근성 태그를 부여해 필터·태그가 목모드에서도 시연되게 한다(FR-10 AC4).
// 방어적으로 몇 개 id 를 더 채워두되, 데이터 없는 id 는 응답에서 생략한다(P-1).

import type { AccessibilityMap, FacilityAccessibility } from '../types_accessibility'

const CHECKED = '2026-07-21'

// D01 은 편의시설 일부만 보유 → 편의시설 칩으로 "리스트 감소"가 시연된다
// (예: 보유하지 않은 '수중리프트/휠체어 대여' 칩 선택 시 목록에서 빠진다).
const MOCK_ACCESSIBILITY: AccessibilityMap = {
  D01: {
    types: ['지체', '뇌병변'],
    amenities: [
      { code: '01', name: '장애인 화장실' },
      { code: '02', name: '장애인용 엘리베이터' },
      { code: '04', name: '주출입구 단차없음' },
    ],
    source: '장애인이용권 웹 공개 정보',
    checked: CHECKED,
  },
  // 비페르소나 위저드 입력(목 규칙엔진 경로)에서 잡힐 수 있는 예비 id 들.
  D02: {
    types: ['시각', '청각'],
    amenities: [
      { code: '01', name: '장애인 화장실' },
      { code: '06', name: '휠체어 대여' },
      { code: '07', name: '시각장애인 편의서비스' },
      { code: '09', name: '수중리프트' },
    ],
    source: '장애인이용권 웹 공개 정보',
    checked: CHECKED,
  },
}

export function resolveMockAccessibility(ids: string[]): AccessibilityMap {
  const out: AccessibilityMap = {}
  for (const id of ids) {
    const hit: FacilityAccessibility | undefined = MOCK_ACCESSIBILITY[id]
    if (hit) out[id] = hit
  }
  return out
}

export { MOCK_ACCESSIBILITY }

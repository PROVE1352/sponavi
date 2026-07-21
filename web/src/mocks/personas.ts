// SPEC §5 데모 페르소나 P1~P4 의 assess 요청 바디 + 계약-형태 응답(목).
// 근거: docs/API.md 응답 예시 + data/fixtures/*.json (성북 좌표·시설명·수강료·커버리지 재사용).
// P4는 SPEC §5에서 "서버 에이전트가 dvoucher 공식 검증 후 확정"으로 남은 유일한 미정 지점.
//   → dvoucher 연령 상한(만 69세)이 존재한다고 가정하고 "72세 청각장애(연령 초과)" 케이스를 채택.
//     소득기준 의존이 없어 가장 방어적. dvoucher 규칙 verified:false 로 표기(SPEC §0-5).

import type { AltEdge, AssessResponse, DemoPersona, Selection } from '../types'

const SVOUCHER_APPLY = {
  how: '온라인 신청 → 이용권 카드 발급 → 가맹시설에서 결제 시 지원금 자동 차감',
  url: 'https://svoucher.kspo.or.kr',
  docs: ['신분증(또는 등본)', '기초수급·차상위·한부모 증명서'],
}
const SVOUCHER_SOURCE = { url: 'https://svoucher.kspo.or.kr', checked: '2026-07-20' }

const DVOUCHER_APPLY = {
  how: '온라인 신청 → 이용권 발급 → 장애인 가맹시설에서 이용',
  url: 'https://dvoucher.kspo.or.kr',
  docs: ['신분증', '장애인등록증(복지카드)', '소득 증빙(해당 시)'],
}
const DVOUCHER_SOURCE = { url: 'https://dvoucher.kspo.or.kr', checked: '2026-07-20' }

const PUBLIC_APPLY = {
  how: '각 구민체육센터·공공체육시설에 직접 등록(전화·방문·홈페이지). 저소득·장애인 할인 문의',
  url: 'https://www.seoul.go.kr',
  docs: ['신분증'],
}
const PUBLIC_SOURCE = { url: 'https://www.seoul.go.kr', checked: '2026-07-20' }

const SVOUCHER_BENEFIT = '월 최대 10만 5천원 강좌비 지원 (유청소년 기준)'
const DVOUCHER_BENEFIT = '월 최대 11만원 강좌비 지원 (장애인) · 금액·기준 공식 확인 필요'
const PUBLIC_BENEFIT = '무료 또는 저가(월 0~4만원대) 프로그램'

// 성북구 차상위·한부모 커버리지(= docs/API.md 예시값, 정직-신호 핵심). 구 단위 통계.
const COVERAGE_SB_NEARPOOR = {
  sigungu: '성북구',
  class: '차상위·한부모',
  target: 602,
  recipient: 9,
  rate: 0.015,
  year: 2025,
}

// ---------- 대체경로(alt_edges) 목적지 제도 메타 (data/rules.json 요약) ----------
const ALT_PROGRAMS = {
  public_program: {
    id: 'public_program',
    name: '공공체육시설 프로그램(무료/저가)',
    benefit: '무료 또는 저가(월 0~4만원대) 생활체육 프로그램 — 자격 제한 없음',
    apply_url: 'https://www.kspo.or.kr',
  },
  tteuntteun: {
    id: 'tteuntteun',
    name: '튼튼머니(스포츠활동 인센티브)',
    benefit: '만 4세+ 누구나 · 소득 무관 · 스포츠활동/체력측정으로 연 최대 5만 포인트 적립',
    apply_url: 'https://nfa.kspo.or.kr/spoint/selectSpointIntro.kspo',
  },
  culture_deduction: {
    id: 'culture_deduction',
    name: '체육시설 문화비 소득공제',
    benefit: '헬스장·수영장 이용료 30% 소득공제(총급여 7천만원 이하 근로소득자)',
    apply_url: 'https://www.culture.go.kr/deduction',
  },
  senior_voucher: {
    id: 'senior_voucher',
    name: '어르신 스포츠 상품권',
    benefit: '기초연금 수급 65세+ · 상품권 최대 15만원(제로페이 스포츠시설)',
    apply_url: 'https://ssvoucher.co.kr',
  },
  senior_free_class: {
    id: 'senior_free_class',
    name: '어르신 스포츠강좌 프로그램(무료 강좌)',
    benefit: '65세+ 누구나 · 소득 무관 무료 강좌(요가·기체조·파크골프 등)',
    apply_url: 'https://www.mcst.go.kr',
  },
}

const OFFICIAL = '공식 확인(2026-07-21)'
const PENDING = '검증 대기'

// 선정순위 출처(rules dvoucher.selection_priority.source 요약)
const SELECTION_SOURCE = {
  url: 'https://dvoucher.kspo.or.kr/dvoucher/main/contents.do?menuNo=800011&topMenuNo=800010',
  checked: '2026-07-21',
  note: '공식 선정순위 5단계(1순위 5~18 수급·차상위·한부모 ~ 5순위 19+ 비저소득)',
}
const SELECTION_TIEBREAK =
  '우선선정: 과거 누적 24개월 미만 이용자 → 동일 기준 내 기초생활수급 가구 → 기타 동일 자격은 시군구 자율 선정'
const SELECTION_NOTE = '선정은 우선순위제 — 지자체 예산·경쟁에 따라 대기 가능'

const SELECTION_RANK1_YOUTH: Selection = {
  expected_rank: 1,
  rank_label: '예상 1순위(유청소년·차상위·한부모)',
  note: SELECTION_NOTE,
  tiebreak: SELECTION_TIEBREAK,
  source: SELECTION_SOURCE,
}
const SELECTION_RANK5_ADULT: Selection = {
  expected_rank: 5,
  rank_label: '예상 5순위(성인·비저소득)',
  note: SELECTION_NOTE,
  tiebreak: SELECTION_TIEBREAK,
  source: SELECTION_SOURCE,
}

// P2: svoucher 소득·연령 미달 → 매칭 대체경로(상위 3 노출)
const P2_ALT_EDGES: AltEdge[] = [
  { to: 'public_program', note: '이용권 소득기준 미달 → 공공체육시설 무료/저가 프로그램', curated: PENDING, program: ALT_PROGRAMS.public_program },
  { to: 'tteuntteun', note: '이용권 소득기준 미달 → 튼튼머니(만 4세+ 소득무관 포인트 적립)', curated: OFFICIAL, program: ALT_PROGRAMS.tteuntteun },
  { to: 'culture_deduction', note: '근로소득자면 헬스장·수영장 30% 소득공제', curated: OFFICIAL, program: ALT_PROGRAMS.culture_deduction },
]

// P4: dvoucher 연령 초과(72세) → 어르신 특화 대체경로
const P4_ALT_EDGES: AltEdge[] = [
  { to: 'public_program', note: '장애인 이용권 연령 초과 → 장애인 지원 공공체육시설', curated: PENDING, program: ALT_PROGRAMS.public_program },
  { to: 'senior_voucher', note: '이용권 연령(69세) 초과 어르신 → 기초연금 수급 시 어르신 스포츠 상품권(최대 15만)', curated: OFFICIAL, program: ALT_PROGRAMS.senior_voucher },
  { to: 'senior_free_class', note: '65세+ 누구나 → 어르신 무료 스포츠강좌(소득 무관)', curated: OFFICIAL, program: ALT_PROGRAMS.senior_free_class },
]

// P5: dvoucher 자격 ✓ 이나 예상 5순위 → 대기 동안 '지금 바로 되는' 공식 확인 대안 3
const P5_ALT_EDGES: AltEdge[] = [
  { to: 'public_program', note: '장애인 접근성 지원 공공체육시설 — 지금 등록 가능', curated: OFFICIAL, program: ALT_PROGRAMS.public_program },
  { to: 'tteuntteun', note: '만 4세+ 누구나 · 소득 무관 스포츠활동 포인트 적립', curated: OFFICIAL, program: ALT_PROGRAMS.tteuntteun },
  { to: 'culture_deduction', note: '근로소득자면 헬스장·수영장 이용료 30% 소득공제', curated: OFFICIAL, program: ALT_PROGRAMS.culture_deduction },
]

// ---------- 요청 바디 (GET /api/demo/personas) ----------
export const PERSONA_REQUESTS: DemoPersona[] = [
  {
    id: 'P1',
    label: '기초수급 아동',
    summary: '스포츠강좌이용권 예상 자격 ✓ → 신청 안내 + 가맹시설·자부담',
    age: 10,
    sex: 'F',
    sigungu_cd: '11290',
    sigungu_nm: '성북구',
    income_class: '기초생활수급',
    disability: { has: false, type: null },
    location: { lat: 37.6057, lon: 127.017 },
  },
  {
    id: 'P2',
    label: '낀 계층 청년',
    summary: '이용권 ✗(소득·연령) → 대체경로 → 공공시설 + 체력처방',
    age: 27,
    sex: 'M',
    sigungu_cd: '11290',
    sigungu_nm: '성북구',
    income_class: '그외',
    disability: { has: false, type: null },
    location: { lat: 37.6057, lon: 127.017 },
  },
  {
    id: 'P3',
    label: '지체장애 청소년',
    summary: '장애인스포츠강좌이용권 ✓ → 접근성 시설(단, 성북 내 가맹 0 → 공급공백)',
    age: 14,
    sex: 'F',
    sigungu_cd: '11290',
    sigungu_nm: '성북구',
    income_class: '차상위',
    disability: { has: true, type: '지체' },
    location: { lat: 37.6057, lon: 127.017 },
  },
  {
    id: 'P4',
    label: '연령 초과 어르신',
    summary: '장애인 이용권 ✗(연령 초과) → 공급공백 배너 + 장애 특화 대체경로',
    age: 72,
    sex: 'M',
    sigungu_cd: '11290',
    sigungu_nm: '성북구',
    income_class: '그외',
    disability: { has: true, type: '청각' },
    location: { lat: 37.6057, lon: 127.017 },
  },
  {
    id: 'P5',
    label: '비저소득 성인 장애인',
    summary: '장애인 이용권 ✓(신청 소득무관) · 예상 5순위 → 지금 바로 되는 대체경로',
    age: 32,
    sex: 'M',
    sigungu_cd: '11290',
    sigungu_nm: '성북구',
    income_class: '그외',
    disability: { has: true, type: '지체' },
    location: { lat: 37.6057, lon: 127.017 },
  },
]

// ---------- P1: svoucher 예상 자격 ✓ ----------
const P1: AssessResponse = {
  eligibility: [
    {
      program_id: 'svoucher',
      program_name: '스포츠강좌이용권',
      eligible: true,
      reasons: [
        { field: 'age', ok: true, message: '만 10세 · 지원 연령(만 5~18세)에 해당합니다' },
        { field: 'income_class', ok: true, message: '기초생활수급 · 소득 지원 대상입니다' },
      ],
      benefit: SVOUCHER_BENEFIT,
      apply: SVOUCHER_APPLY,
      source: SVOUCHER_SOURCE,
      verified: true,
    },
    {
      program_id: 'dvoucher',
      program_name: '장애인스포츠강좌이용권',
      eligible: false,
      reasons: [
        { field: 'disability', ok: false, message: '장애 등록 정보가 없어 장애인 이용권 대상이 아닙니다' },
      ],
      benefit: DVOUCHER_BENEFIT,
      apply: DVOUCHER_APPLY,
      source: DVOUCHER_SOURCE,
      verified: false,
    },
    {
      program_id: 'public_program',
      program_name: '공공체육시설 프로그램(무료/저가)',
      eligible: true,
      reasons: [{ field: 'income_class', ok: true, message: '누구나 이용 가능한 공공 프로그램입니다' }],
      benefit: PUBLIC_BENEFIT,
      apply: PUBLIC_APPLY,
      source: PUBLIC_SOURCE,
      verified: true,
    },
  ],
  path: [
    { from: 'person', to: 'svoucher', edge: '자격', result: 'ok', label: '만 5~18세·기초수급 충족' },
    { from: 'svoucher', to: 'facility:V01', edge: '적합·접근', result: 'ok', label: '성북스포츠클럽 · 0.3km' },
  ],
  nearby: {
    voucher_facilities: [
      { id: 'V01', name: '성북스포츠클럽', sports: ['수영', '헬스'], lat: 37.6061, lon: 127.0242, coord_source: 'centroid', dist_km: null, sigungu_nm: '성북구', fee_month: 95000, subsidy: 105000, copay: 0, disability_support: null, source: 'voucher', addr: '서울 성북구 오패산로 12', course_name: '유아·주니어 수영 기초' },
      { id: 'V02', name: '돈암수영아카데미', sports: ['수영'], lat: 37.5972, lon: 127.0135, coord_source: 'centroid', dist_km: null, sigungu_nm: '성북구', fee_month: 110000, subsidy: 105000, copay: 5000, disability_support: null, source: 'voucher', addr: '서울 성북구 아리랑로 55', course_name: '청소년 수영 중급' },
      { id: 'V03', name: '정릉태권체육관', sports: ['태권도'], lat: 37.61, lon: 127.008, coord_source: 'centroid', dist_km: null, sigungu_nm: '성북구', fee_month: 130000, subsidy: 105000, copay: 25000, disability_support: null, source: 'voucher', addr: '서울 성북구 정릉로 200', course_name: '초등 태권도' },
      { id: 'V04', name: '종암필라테스랩', sports: ['필라테스', '요가'], lat: 37.596, lon: 127.033, coord_source: 'centroid', dist_km: null, sigungu_nm: '성북구', fee_month: 160000, subsidy: 105000, copay: 55000, disability_support: null, source: 'voucher', addr: '서울 성북구 종암로 30', course_name: '성인 필라테스 입문' },
    ],
    alternatives: [
      { id: 'P01', name: '성북구민체육센터', type: '공공체육시설', sports: ['요가', '수영', '헬스', '에어로빅'], lat: 37.6046, lon: 127.0413, coord_source: 'api', dist_km: 1.6, sigungu_nm: '성북구', note: '구민 요가(오전 3만원)·실버 수중걷기 무료 · 접근성 지원', disability_support: true, fee_month: 30000, source: 'public', addr: '서울 성북구 화랑로 189' },
    ],
  },
  supply_gap: {
    radius_km: 3,
    voucher_count: 4,
    voucher_scope: 'sigungu',
    sigungu_nm: '성북구',
    alt_count: 3,
    nearest: null,
    message: '스포츠강좌이용권 · 성북구 가맹 4곳',
    coverage: COVERAGE_SB_NEARPOOR,
  },
}

// ---------- P2: svoucher ✗(소득·연령) → 대체경로 → 공공 ----------
const P2: AssessResponse = {
  eligibility: [
    {
      program_id: 'svoucher',
      program_name: '스포츠강좌이용권',
      eligible: false,
      reasons: [
        { field: 'income_class', ok: false, message: '소득 기준(기초·차상위·한부모)에 해당하지 않습니다' },
        { field: 'age', ok: false, message: '지원 연령(만 5~18세)을 초과합니다 (27세)' },
      ],
      benefit: SVOUCHER_BENEFIT,
      apply: SVOUCHER_APPLY,
      source: SVOUCHER_SOURCE,
      verified: true,
    },
    {
      program_id: 'dvoucher',
      program_name: '장애인스포츠강좌이용권',
      eligible: false,
      reasons: [{ field: 'disability', ok: false, message: '장애 등록 정보가 없습니다' }],
      benefit: DVOUCHER_BENEFIT,
      apply: DVOUCHER_APPLY,
      source: DVOUCHER_SOURCE,
      verified: false,
    },
    {
      program_id: 'public_program',
      program_name: '공공체육시설 프로그램(무료/저가)',
      eligible: true,
      reasons: [{ field: 'income_class', ok: true, message: '누구나 이용 가능한 공공 프로그램입니다' }],
      benefit: PUBLIC_BENEFIT,
      apply: PUBLIC_APPLY,
      source: PUBLIC_SOURCE,
      verified: true,
    },
  ],
  path: [
    { from: 'person', to: 'svoucher', edge: '자격', result: 'fail', label: '소득 그외 · 연령 27>18' },
    { from: 'svoucher', to: 'public_program', edge: '대체경로', result: 'ok', label: '무료/저가 공공프로그램', curated: '검증 대기' },
    { from: 'public_program', to: 'facility:P01', edge: '적합·접근', result: 'ok', label: '성북구민체육센터 · 1.6km' },
  ],
  alt_edges: P2_ALT_EDGES,
  nearby: {
    voucher_facilities: [],
    alternatives: [
      { id: 'P01', name: '성북구민체육센터', type: '공공체육시설', sports: ['요가', '수영', '헬스', '에어로빅'], lat: 37.6046, lon: 127.0413, coord_source: 'api', dist_km: 1.6, sigungu_nm: '성북구', note: '구민 요가 오전 월 3만원 · 실버 수중걷기 무료', disability_support: true, fee_month: 30000, source: 'public', addr: '서울 성북구 화랑로 189' },
      { id: 'P03', name: '월곡스포츠문화센터', type: '공공체육시설', sports: ['필라테스', '요가', '스트레칭'], lat: 37.6022, lon: 127.0405, coord_source: 'api', dist_km: 1.6, sigungu_nm: '성북구', note: '저녁 스트레칭·요가 월 4만원', disability_support: false, fee_month: 40000, source: 'public', addr: '서울 성북구 월곡로 21' },
    ],
  },
  supply_gap: {
    radius_km: 3,
    voucher_count: 4,
    voucher_scope: 'sigungu',
    sigungu_nm: '성북구',
    alt_count: 2,
    nearest: null,
    message: '스포츠강좌이용권 · 성북구 가맹 4곳',
    coverage: COVERAGE_SB_NEARPOOR,
  },
}

// ---------- P3: dvoucher 예상 자격 ✓ (단 성북 내 가맹 0 → 공급공백) ----------
const P3: AssessResponse = {
  eligibility: [
    {
      program_id: 'svoucher',
      program_name: '스포츠강좌이용권',
      eligible: false,
      reasons: [
        { field: 'route', ok: false, message: '장애인은 장애인스포츠강좌이용권 대상입니다 (비장애 이용권과 중복 지원 불가)' },
      ],
      benefit: SVOUCHER_BENEFIT,
      apply: SVOUCHER_APPLY,
      source: SVOUCHER_SOURCE,
      verified: true,
    },
    {
      program_id: 'dvoucher',
      program_name: '장애인스포츠강좌이용권',
      eligible: true,
      reasons: [
        { field: 'disability', ok: true, message: '지체장애 등록 · 장애인 이용권 대상입니다' },
        { field: 'age', ok: true, message: '만 14세 · 장애인 이용권 연령 범위에 해당합니다 (공식 확인 필요)' },
        { field: 'income_class', ok: true, message: '차상위 · 소득 우대 대상입니다 (공식 확인 필요)' },
      ],
      benefit: DVOUCHER_BENEFIT,
      apply: DVOUCHER_APPLY,
      source: DVOUCHER_SOURCE,
      verified: false,
      selection: SELECTION_RANK1_YOUTH,
    },
    {
      program_id: 'public_program',
      program_name: '공공체육시설 프로그램(무료/저가)',
      eligible: true,
      reasons: [{ field: 'income_class', ok: true, message: '누구나 이용 가능한 공공 프로그램입니다' }],
      benefit: PUBLIC_BENEFIT,
      apply: PUBLIC_APPLY,
      source: PUBLIC_SOURCE,
      verified: true,
    },
  ],
  path: [
    { from: 'person', to: 'dvoucher', edge: '자격', result: 'ok', label: '장애인 이용권 대상(연령·소득 충족·공식 확인 필요)' },
    { from: 'dvoucher', to: 'facility:D01', edge: '적합·접근', result: 'ok', label: '가장 가까운 장애인 가맹 · 강북구(위치 근사)' },
  ],
  nearby: {
    voucher_facilities: [
      { id: 'D01', name: '서울장애인체육관', sports: ['수영', '재활운동', '탁구'], lat: 37.6396, lon: 127.0257, coord_source: 'centroid', dist_km: null, sigungu_nm: '강북구', fee_month: 0, subsidy: 110000, copay: 0, disability_support: true, source: 'dvoucher', addr: '서울 강북구 한천로 1000', course_name: '장애인 재활 수영(무료)' },
    ],
    alternatives: [
      { id: 'P01', name: '성북구민체육센터', type: '공공체육시설', sports: ['요가', '수영', '헬스', '에어로빅'], lat: 37.6046, lon: 127.0413, coord_source: 'api', dist_km: 1.6, sigungu_nm: '성북구', note: '접근성 지원 시설 · 저가/무료 프로그램', disability_support: true, fee_month: 30000, source: 'public', addr: '서울 성북구 화랑로 189' },
    ],
  },
  supply_gap: {
    radius_km: 3,
    voucher_count: 0,
    voucher_scope: 'sigungu',
    sigungu_nm: '성북구',
    alt_count: 1,
    nearest: { name: '서울장애인체육관', coord_source: 'centroid', dist_km: null, sigungu_nm: '강북구' },
    message: '성북구에 장애인스포츠강좌이용권 가맹시설이 없습니다',
    coverage: COVERAGE_SB_NEARPOOR,
  },
}

// ---------- P4: dvoucher ✗(연령 초과) → 공급공백 + 장애 특화 대체경로 ----------
const P4: AssessResponse = {
  eligibility: [
    {
      program_id: 'svoucher',
      program_name: '스포츠강좌이용권',
      eligible: false,
      reasons: [
        { field: 'route', ok: false, message: '장애인은 장애인스포츠강좌이용권 대상입니다' },
        { field: 'age', ok: false, message: '지원 연령(만 5~18세)을 초과합니다' },
      ],
      benefit: SVOUCHER_BENEFIT,
      apply: SVOUCHER_APPLY,
      source: SVOUCHER_SOURCE,
      verified: true,
    },
    {
      program_id: 'dvoucher',
      program_name: '장애인스포츠강좌이용권',
      eligible: false,
      reasons: [
        { field: 'age', ok: false, message: '연령 72세 · 장애인 이용권 상한(만 69세)을 초과합니다 (공식 확인 필요)' },
      ],
      benefit: DVOUCHER_BENEFIT,
      apply: DVOUCHER_APPLY,
      source: DVOUCHER_SOURCE,
      verified: false,
    },
    {
      program_id: 'public_program',
      program_name: '공공체육시설 프로그램(무료/저가)',
      eligible: true,
      reasons: [{ field: 'income_class', ok: true, message: '누구나 이용 가능한 공공 프로그램입니다 (접근성 지원 시설 우선)' }],
      benefit: PUBLIC_BENEFIT,
      apply: PUBLIC_APPLY,
      source: PUBLIC_SOURCE,
      verified: true,
    },
  ],
  path: [
    { from: 'person', to: 'dvoucher', edge: '자격', result: 'fail', label: '연령 72 > 69 상한' },
    { from: 'dvoucher', to: 'public_program', edge: '대체경로', result: 'ok', label: '접근성 지원 공공프로그램', curated: '검증 대기' },
    { from: 'public_program', to: 'facility:P01', edge: '적합·접근', result: 'ok', label: '성북구민체육센터(접근성 지원) · 1.6km' },
  ],
  alt_edges: P4_ALT_EDGES,
  nearby: {
    voucher_facilities: [],
    alternatives: [
      { id: 'P01', name: '성북구민체육센터', type: '공공체육시설(접근성 지원)', sports: ['요가', '수영', '헬스', '에어로빅'], lat: 37.6046, lon: 127.0413, coord_source: 'api', dist_km: 1.6, sigungu_nm: '성북구', note: '접근성 지원 · 실버 수중걷기 무료교실 · 저가 프로그램', disability_support: true, fee_month: 0, source: 'public', addr: '서울 성북구 화랑로 189' },
    ],
  },
  supply_gap: {
    radius_km: 3,
    voucher_count: 0,
    voucher_scope: 'sigungu',
    sigungu_nm: '성북구',
    alt_count: 1,
    nearest: { name: '서울장애인체육관', coord_source: 'centroid', dist_km: null, sigungu_nm: '강북구' },
    message: '성북구에 장애인스포츠강좌이용권 가맹시설이 없습니다',
    coverage: COVERAGE_SB_NEARPOOR,
  },
}

// ---------- P5: dvoucher 자격 ✓(신청 소득무관) · 예상 5순위 → '지금 바로 되는 것' ----------
const P5: AssessResponse = {
  eligibility: [
    {
      program_id: 'svoucher',
      program_name: '스포츠강좌이용권',
      eligible: false,
      reasons: [
        { field: 'route', ok: false, message: '장애인은 장애인스포츠강좌이용권 대상입니다 (비장애 이용권과 중복 지원 불가)' },
      ],
      benefit: SVOUCHER_BENEFIT,
      apply: SVOUCHER_APPLY,
      source: SVOUCHER_SOURCE,
      verified: true,
    },
    {
      program_id: 'dvoucher',
      program_name: '장애인스포츠강좌이용권',
      eligible: true,
      reasons: [
        { field: 'disability', ok: true, message: '지체장애 등록 · 장애인 이용권 대상입니다' },
        { field: 'age', ok: true, message: '만 32세 · 장애인 이용권 연령 범위(만 5~69세)에 해당합니다 (공식 확인 필요)' },
        { field: 'income_class', ok: true, message: '소득 무관 · 등록 장애인이면 신청 가능(저소득 우선선정)' },
      ],
      benefit: DVOUCHER_BENEFIT,
      apply: DVOUCHER_APPLY,
      source: DVOUCHER_SOURCE,
      verified: false,
      selection: SELECTION_RANK5_ADULT,
    },
    {
      program_id: 'public_program',
      program_name: '공공체육시설 프로그램(무료/저가)',
      eligible: true,
      reasons: [{ field: 'income_class', ok: true, message: '누구나 이용 가능한 공공 프로그램입니다 (접근성 지원 시설 우선)' }],
      benefit: PUBLIC_BENEFIT,
      apply: PUBLIC_APPLY,
      source: PUBLIC_SOURCE,
      verified: true,
    },
  ],
  path: [
    { from: 'person', to: 'dvoucher', edge: '자격', result: 'ok', label: '장애인 이용권 대상(소득무관·공식 확인 필요)' },
    { from: 'dvoucher', to: 'facility:D01', edge: '적합·접근', result: 'ok', label: '가장 가까운 장애인 가맹 · 강북구(위치 근사)' },
  ],
  alt_edges: P5_ALT_EDGES,
  nearby: {
    voucher_facilities: [
      { id: 'D01', name: '서울장애인체육관', sports: ['수영', '재활운동', '탁구'], lat: 37.6396, lon: 127.0257, coord_source: 'centroid', dist_km: null, sigungu_nm: '강북구', fee_month: 0, subsidy: 110000, copay: 0, disability_support: true, source: 'dvoucher', addr: '서울 강북구 한천로 1000', course_name: '장애인 재활 수영(무료)' },
    ],
    alternatives: [
      { id: 'P01', name: '성북구민체육센터', type: '공공체육시설(접근성 지원)', sports: ['요가', '수영', '헬스', '에어로빅'], lat: 37.6046, lon: 127.0413, coord_source: 'api', dist_km: 1.6, sigungu_nm: '성북구', note: '접근성 지원 · 저가/무료 프로그램', disability_support: true, fee_month: 0, source: 'public', addr: '서울 성북구 화랑로 189' },
    ],
  },
  supply_gap: {
    radius_km: 3,
    voucher_count: 0,
    voucher_scope: 'sigungu',
    sigungu_nm: '성북구',
    alt_count: 1,
    nearest: { name: '서울장애인체육관', coord_source: 'centroid', dist_km: null, sigungu_nm: '강북구' },
    message: '성북구에 장애인스포츠강좌이용권 가맹시설이 없습니다',
    coverage: COVERAGE_SB_NEARPOOR,
  },
}

export const PERSONA_RESPONSES: Record<string, AssessResponse> = { P1, P2, P3, P4, P5 }

// data/fixtures/*.json 의 값을 재사용한 목-모드 임베드 데이터.
// 실데이터가 아니라 데모용 시드다. 실연동 시 서버가 fixtures/DB에서 같은 스키마로 응답한다.
// 참고: docs/SPEC.md §2, docs/API.md, data/fixtures/{facilities,courses,coverage_seoul_2025}.json

import type { CoordSource, Sigungu } from '../types'

export interface RawFacility {
  id: string
  source: 'voucher' | 'dvoucher' | 'public'
  name: string
  sigungu_cd: string
  sigungu_nm: string
  addr: string
  lat: number
  lon: number
  // 좌표 정직성(FR-04): 이용권=구 중심 폴백(centroid), 공공=실좌표(api).
  coord_source: CoordSource
  sports: string[]
  disability_support: boolean | null
  phone: string
}

// data/fixtures/facilities.json 그대로 (coord_source 포함)
export const FACILITIES: RawFacility[] = [
  { id: 'V01', source: 'voucher',  name: '성북스포츠클럽',     sigungu_cd: '11290', sigungu_nm: '성북구', addr: '서울 성북구 오패산로 12', lat: 37.6061, lon: 127.0242, coord_source: 'centroid', sports: ['수영', '헬스'], disability_support: null, phone: '02-000-0001' },
  { id: 'V02', source: 'voucher',  name: '돈암수영아카데미',   sigungu_cd: '11290', sigungu_nm: '성북구', addr: '서울 성북구 아리랑로 55', lat: 37.5972, lon: 127.0135, coord_source: 'centroid', sports: ['수영'], disability_support: null, phone: '02-000-0002' },
  { id: 'V03', source: 'voucher',  name: '정릉태권체육관',     sigungu_cd: '11290', sigungu_nm: '성북구', addr: '서울 성북구 정릉로 200', lat: 37.6100, lon: 127.0080, coord_source: 'centroid', sports: ['태권도'], disability_support: null, phone: '02-000-0003' },
  { id: 'V04', source: 'voucher',  name: '종암필라테스랩',     sigungu_cd: '11290', sigungu_nm: '성북구', addr: '서울 성북구 종암로 30', lat: 37.5960, lon: 127.0330, coord_source: 'centroid', sports: ['필라테스', '요가'], disability_support: null, phone: '02-000-0004' },
  { id: 'V05', source: 'voucher',  name: '강남스윔센터',       sigungu_cd: '11680', sigungu_nm: '강남구', addr: '서울 강남구 선릉로 100', lat: 37.5045, lon: 127.0490, coord_source: 'centroid', sports: ['수영'], disability_support: null, phone: '02-000-0005' },
  { id: 'P01', source: 'public',   name: '성북구민체육센터',   sigungu_cd: '11290', sigungu_nm: '성북구', addr: '서울 성북구 화랑로 189', lat: 37.6046, lon: 127.0413, coord_source: 'api', sports: ['요가', '수영', '헬스', '에어로빅'], disability_support: true, phone: '02-000-0011' },
  { id: 'P02', source: 'public',   name: '아리랑체육관',       sigungu_cd: '11290', sigungu_nm: '성북구', addr: '서울 성북구 아리랑로 82', lat: 37.6008, lon: 127.0117, coord_source: 'api', sports: ['배드민턴', '탁구'], disability_support: false, phone: '02-000-0012' },
  { id: 'P03', source: 'public',   name: '월곡스포츠문화센터', sigungu_cd: '11290', sigungu_nm: '성북구', addr: '서울 성북구 월곡로 21', lat: 37.6022, lon: 127.0405, coord_source: 'api', sports: ['필라테스', '요가', '스트레칭'], disability_support: false, phone: '02-000-0013' },
  { id: 'P04', source: 'public',   name: '용산가족체육센터',   sigungu_cd: '11170', sigungu_nm: '용산구', addr: '서울 용산구 이촌로 200', lat: 37.5220, lon: 126.9720, coord_source: 'api', sports: ['수영', '헬스'], disability_support: true, phone: '02-000-0014' },
  { id: 'D01', source: 'dvoucher', name: '서울장애인체육관',   sigungu_cd: '11305', sigungu_nm: '강북구', addr: '서울 강북구 한천로 1000', lat: 37.6396, lon: 127.0257, coord_source: 'centroid', sports: ['수영', '재활운동', '탁구'], disability_support: true, phone: '02-000-0021' },
]

export interface RawCourse {
  id: string
  facility_id: string
  name: string
  sport: string
  weekday_mask: string
  start: string
  end: string
  fee_month: number
  target: string
}

// data/fixtures/courses.json 그대로
export const COURSES: RawCourse[] = [
  { id: 'C01', facility_id: 'V01', name: '유아·주니어 수영 기초',   sport: '수영',    weekday_mask: '1010100', start: '16:00', end: '16:50', fee_month: 95000,  target: '유청소년' },
  { id: 'C02', facility_id: 'V02', name: '청소년 수영 중급',       sport: '수영',    weekday_mask: '0101000', start: '17:00', end: '17:50', fee_month: 110000, target: '유청소년' },
  { id: 'C03', facility_id: 'V03', name: '초등 태권도',            sport: '태권도',  weekday_mask: '1111100', start: '15:30', end: '16:20', fee_month: 130000, target: '유청소년' },
  { id: 'C04', facility_id: 'V04', name: '성인 필라테스 입문',     sport: '필라테스', weekday_mask: '0101000', start: '19:00', end: '19:50', fee_month: 160000, target: '성인' },
  { id: 'C05', facility_id: 'P01', name: '구민 요가 (오전 저가)',  sport: '요가',    weekday_mask: '1010100', start: '10:00', end: '10:50', fee_month: 30000,  target: '전연령' },
  { id: 'C06', facility_id: 'P01', name: '실버 수중걷기 무료교실', sport: '수영',    weekday_mask: '0101000', start: '09:00', end: '09:50', fee_month: 0,      target: '어르신' },
  { id: 'C07', facility_id: 'P03', name: '저녁 스트레칭·요가',     sport: '요가',    weekday_mask: '1111100', start: '20:00', end: '20:50', fee_month: 40000,  target: '성인' },
  { id: 'C08', facility_id: 'D01', name: '장애인 재활 수영',       sport: '수영',    weekday_mask: '1010100', start: '14:00', end: '14:50', fee_month: 0,      target: '장애인' },
  { id: 'C09', facility_id: 'D01', name: '휠체어 탁구 교실',       sport: '탁구',    weekday_mask: '0101000', start: '15:00', end: '15:50', fee_month: 0,      target: '장애인' },
  { id: 'C10', facility_id: 'P04', name: '가족 수영 (주말)',       sport: '수영',    weekday_mask: '0000011', start: '11:00', end: '11:50', fee_month: 50000,  target: '전연령' },
]

// data/fixtures/courses.json 의 videos
export const VIDEOS = [
  { title: '국민체력100 유연성 개선 스트레칭', url: 'https://nfa.kspo.or.kr/', source: '국민체력100 동영상 API(15108846) — 실연동은 키 주입 후', for_weakness: '유연성' },
  { title: '심폐지구력 향상 걷기 프로그램',     url: 'https://nfa.kspo.or.kr/', source: '국민체력100 동영상 API(15108846) — 실연동은 키 주입 후', for_weakness: '심폐지구력' },
  { title: '근력 향상 홈트(악력·코어)',         url: 'https://nfa.kspo.or.kr/', source: '국민체력100 동영상 API(15108846) — 실연동은 키 주입 후', for_weakness: '근력' },
]

// 커버리지 통계.
// ⚠️ data/fixtures/coverage_seoul_2025.json 실측행은 종로·중구·용산·성동·광진 5개 구뿐이며 성북구(11290)는 없다.
// 그런데 docs/API.md 응답 예시는 성북구 차상위·한부모 = target 602 / recipient 9 / rate 0.015 를 보여준다
// (이 수치는 fixtures 상 성동구 N-class 실측행과 동일). 페르소나가 전부 성북구라 데모 정직-신호를 위해
// API.md 예시 라인을 성북구 행으로 임베드한다. (서버 연동 시 성북 커버리지가 없으면 coverage:null 가능 — 보고서에 기재)
export type CoverageClassCode = 'S' | 'N'

export interface CoverageRow {
  sigungu_cd: string
  sigungu_nm: string
  class: CoverageClassCode // S=기초생활수급, N=차상위·한부모
  target: number
  recipient: number
}

export const COVERAGE_ROWS: CoverageRow[] = [
  { sigungu_cd: '11110', sigungu_nm: '종로구', class: 'N', target: 321, recipient: 16 },
  { sigungu_cd: '11110', sigungu_nm: '종로구', class: 'S', target: 367, recipient: 70 },
  { sigungu_cd: '11140', sigungu_nm: '중구', class: 'N', target: 278, recipient: 7 },
  { sigungu_cd: '11140', sigungu_nm: '중구', class: 'S', target: 417, recipient: 84 },
  { sigungu_cd: '11170', sigungu_nm: '용산구', class: 'N', target: 449, recipient: 14 },
  { sigungu_cd: '11170', sigungu_nm: '용산구', class: 'S', target: 699, recipient: 197 },
  { sigungu_cd: '11200', sigungu_nm: '성동구', class: 'N', target: 602, recipient: 9 },
  { sigungu_cd: '11200', sigungu_nm: '성동구', class: 'S', target: 752, recipient: 161 },
  { sigungu_cd: '11215', sigungu_nm: '광진구', class: 'N', target: 1147, recipient: 37 },
  { sigungu_cd: '11215', sigungu_nm: '광진구', class: 'S', target: 1435, recipient: 396 },
  // docs/API.md 예시 라인(데모): 성북구 차상위·한부모 수급률 1.5%
  { sigungu_cd: '11290', sigungu_nm: '성북구', class: 'N', target: 602, recipient: 9 },
]

export const CLASS_LABEL: Record<CoverageClassCode, string> = {
  S: '기초생활수급',
  N: '차상위·한부모',
}

// 서울 25개 구 중심좌표 (data/sigungu_centroids.json 시드 대체). 성북·강북·용산·성동·광진·강남은 fixtures 값 정합.
export const SIGUNGU: Sigungu[] = [
  { cd: '11110', nm: '종로구', lat: 37.5735, lon: 126.979 },
  { cd: '11140', nm: '중구', lat: 37.5641, lon: 126.9979 },
  { cd: '11170', nm: '용산구', lat: 37.5326, lon: 126.9906 },
  { cd: '11200', nm: '성동구', lat: 37.5634, lon: 127.0369 },
  { cd: '11215', nm: '광진구', lat: 37.5385, lon: 127.0823 },
  { cd: '11230', nm: '동대문구', lat: 37.5744, lon: 127.0396 },
  { cd: '11260', nm: '중랑구', lat: 37.6063, lon: 127.0925 },
  { cd: '11290', nm: '성북구', lat: 37.6057, lon: 127.017 },
  { cd: '11305', nm: '강북구', lat: 37.6396, lon: 127.0257 },
  { cd: '11320', nm: '도봉구', lat: 37.6688, lon: 127.0471 },
  { cd: '11350', nm: '노원구', lat: 37.6543, lon: 127.0568 },
  { cd: '11380', nm: '은평구', lat: 37.6027, lon: 126.9291 },
  { cd: '11410', nm: '서대문구', lat: 37.5791, lon: 126.9368 },
  { cd: '11440', nm: '마포구', lat: 37.5663, lon: 126.9019 },
  { cd: '11470', nm: '양천구', lat: 37.517, lon: 126.8664 },
  { cd: '11500', nm: '강서구', lat: 37.5509, lon: 126.8495 },
  { cd: '11530', nm: '구로구', lat: 37.4954, lon: 126.8874 },
  { cd: '11545', nm: '금천구', lat: 37.4569, lon: 126.8956 },
  { cd: '11560', nm: '영등포구', lat: 37.5264, lon: 126.8963 },
  { cd: '11590', nm: '동작구', lat: 37.5124, lon: 126.9393 },
  { cd: '11620', nm: '관악구', lat: 37.4784, lon: 126.9516 },
  { cd: '11650', nm: '서초구', lat: 37.4837, lon: 127.0324 },
  { cd: '11680', nm: '강남구', lat: 37.5172, lon: 127.0473 },
  { cd: '11710', nm: '송파구', lat: 37.5145, lon: 127.1059 },
  { cd: '11740', nm: '강동구', lat: 37.5301, lon: 127.1238 },
  // ── 서울 외 표본(v1.7) ──────────────────────────────────────────────
  // 지역 질문이 "시도 → 시군구" 2단계 칩이 되면서(FR-12 AC1 v1.7), 목 데이터가
  // 서울 한 곳뿐이면 1단계가 칩 1개짜리 껍데기가 되어 흐름을 검증할 수 없다.
  // 실서버(/api/meta/sigungu)는 전국 목록을 준다 — 여기서는 그 형태를 대표하는
  // 최소 표본만 둔다: 동명이지역("서구" 4곳)과 시군구가 1곳뿐인 시도(세종).
  // 좌표는 각 시·군·구청 소재지 기준 근사값(WGS84, 소수 4자리).
  { cd: '26140', nm: '서구', lat: 35.0979, lon: 129.0244 },
  { cd: '27170', nm: '서구', lat: 35.8718, lon: 128.5593 },
  { cd: '28260', nm: '서구', lat: 37.5455, lon: 126.6759 },
  // 전남광주통합특별시(12) — 2026-07-01 광주(29)+전남(46) 통합. 구 코드는 쓰지 않는다.
  { cd: '12240', nm: '서구', lat: 35.1518, lon: 126.8902 },
  { cd: '12300', nm: '북구', lat: 35.1988, lon: 126.9027 },
  { cd: '36110', nm: '세종특별자치시', lat: 36.4801, lon: 127.289 },
  { cd: '41111', nm: '수원시 장안구', lat: 37.3049, lon: 127.0107 },
  { cd: '41135', nm: '성남시 분당구', lat: 37.3826, lon: 127.1189 },
]

// 하버사인 거리(km)
export function distKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

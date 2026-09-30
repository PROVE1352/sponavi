import { describe, expect, it } from 'vitest'
import CONTRACT_JSON from '../mocks/contract/area_search.json'
import type { UnlocatedArea } from '../types_search'
import {
  AREA_LIMIT,
  AREA_MAX_DIAG_KM,
  AREA_MAX_LON_SPAN_DEG,
  BOUNDS_EPS_DEG,
  EARTH_R_KM,
  KOREA_BOUNDS,
  MOD_WHEEL_WINDOW_MS,
  Q_MAX,
  areaControlState,
  areaErrorRetryable,
  areaGate,
  areaSectionPlan,
  barCounts,
  barTitle,
  cameraMoved,
  classifyMoveStart,
  countText,
  diagKm,
  doneAnnouncement,
  haversineKm,
  dropQText,
  partialText,
  programNoun,
  qIncludedText,
  sameBounds,
  scopeOverridePrompt,
  sectionFailedText,
  sectionZeroText,
  settleAfterRequest,
  toAreaBounds,
  unlocatedHeadline,
  voucherGuide,
  type AreaGate,
  type LastMove,
} from './areaSearch'

const J = CONTRACT_JSON as unknown as {
  max_diag_km: number
  max_lon_span_deg: number
  limit_default: number
  limit_max: number
  q_max: number
  korea_bounds: typeof KOREA_BOUNDS
  earth_radius_km: number
}

const A = { min_lat: 37.595, min_lon: 127.005, max_lat: 37.612, max_lon: 127.045 }
const WIDE = { min_lat: 37.4, min_lon: 126.8, max_lat: 37.7, max_lon: 127.2 }

function area(cd: string, label: string, count: number, display = label): UnlocatedArea {
  return {
    sigungu_cd: cd,
    sigungu_nm: label,
    sido_nm: null,
    label,
    display_label: display,
    scope_codes: [cd],
    count,
    included_by: ['center'],
  }
}

describe('상수 = 계약 JSON', () => {
  it('서버·목과 같은 값', () => {
    expect(AREA_MAX_DIAG_KM).toBe(J.max_diag_km)
    expect(AREA_LIMIT).toBe(J.limit_default)
    expect(AREA_LIMIT).toBe(J.limit_max)
    expect(Q_MAX).toBe(J.q_max)
    expect({ ...KOREA_BOUNDS }).toEqual(J.korea_bounds)
    expect(EARTH_R_KM).toBe(J.earth_radius_km)
  })
  it('웹 전용 상수', () => {
    expect(BOUNDS_EPS_DEG).toBe(5e-6)
    expect(MOD_WHEEL_WINDOW_MS).toBe(300)
  })
})

describe('diagKm · areaGate', () => {
  it('A 범위 4.00km · 넓은 범위 48.54km', () => {
    expect(diagKm(A)).toBeCloseTo(4.0, 1)
    expect(Math.abs(diagKm(A) - 4.0)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(diagKm(WIDE) - 48.54)).toBeLessThanOrEqual(0.01)
  })

  it('19.99km 는 ok, 20.02km 는 too_wide', () => {
    expect(areaGate({ min_lat: 37.5, min_lon: 127.0, max_lat: 37.6798, max_lon: 127.0001 })).toBe('ok')
    expect(areaGate({ min_lat: 37.5, min_lon: 127.0, max_lat: 37.68, max_lon: 127.0001 })).toBe('too_wide')
  })

  it('우선순위 invalid → outside → too_wide → ok', () => {
    // 국외이면서 너무 넓으면 outside 가 먼저
    expect(areaGate({ min_lat: 35.0, min_lon: 140.0, max_lat: 35.5, max_lon: 140.5 })).toBe('outside')
    expect(areaGate({ min_lat: 35.0, min_lon: 140.0, max_lat: 35.1, max_lon: 140.1 })).toBe('outside')
    // 뒤집힌 범위·같은 값·NaN 은 invalid
    expect(areaGate({ ...A, min_lat: 37.612, max_lat: 37.595 })).toBe('invalid')
    expect(areaGate({ ...A, max_lon: A.min_lon })).toBe('invalid')
    expect(areaGate({ ...A, min_lat: Number.NaN })).toBe('invalid')
    expect(areaGate({ ...A, max_lat: 91 })).toBe('invalid')
    // 넓기만 하면 too_wide
    expect(areaGate(WIDE)).toBe('too_wide')
    expect(areaGate(A)).toBe('ok')
  })

  it('경도 폭이 180° 를 넘으면 too_wide(haversine 이 반대편 짧은 길로 재는 구멍) — 서버·목과 같은 식', () => {
    const wrap = { min_lat: 37.5, min_lon: -180, max_lat: 37.6, max_lon: 180 }
    // 짧은 길 haversine 은 위도 차 11.1km 만 남는다 — 그대로 쓰면 "20km 이내"로 통과했다
    expect(haversineKm(wrap.min_lat, wrap.min_lon, wrap.max_lat, wrap.max_lon)).toBeLessThan(20)
    expect(areaGate(wrap)).toBe('too_wide')
    expect(areaGate({ ...wrap, min_lon: -179.95 })).toBe('too_wide')
    expect(areaGate({ min_lat: 37.5, min_lon: -100, max_lat: 37.6, max_lon: 130 })).toBe('too_wide')
    // 거절 메시지용 대각선은 서→동 긴 길(위도 평균 경도 호 + 위도 호) — 수천 km
    expect(diagKm(wrap)).toBeGreaterThan(30_000)
    const phi = ((37.5 + 37.6) / 2) * (Math.PI / 180)
    expect(diagKm(wrap)).toBeCloseTo(EARTH_R_KM * Math.hypot(2 * Math.PI * Math.cos(phi), 0.1 * (Math.PI / 180)), 6)
    // 폭 180° 이하는 그대로 haversine(기존 경계 불변)
    expect(diagKm(A)).toBe(haversineKm(A.min_lat, A.min_lon, A.max_lat, A.max_lon))
    expect(AREA_MAX_LON_SPAN_DEG).toBe(J.max_lon_span_deg)
  })

  it('한국과 일부만 겹치면 ok(잘라내지 않는다)', () => {
    expect(areaGate({ min_lat: 39.55, min_lon: 125.0, max_lat: 39.65, max_lon: 125.05 })).toBe('ok')
  })

  it('bearing·pitch 가 0 이 아니면 invalid', () => {
    expect(areaGate(A, { bearing: 15, pitch: 0 })).toBe('invalid')
    expect(areaGate(A, { bearing: 0, pitch: 10 })).toBe('invalid')
    expect(areaGate(A, { bearing: 0, pitch: 0 })).toBe('ok')
  })
})

describe('classifyMoveStart 진리표', () => {
  const base = { resizing: false, programmatic: false, hasOriginalEvent: false, msSinceModWheel: null }
  it('resize 가 가장 먼저, 그다음 program', () => {
    expect(classifyMoveStart({ ...base, resizing: true, programmatic: true, hasOriginalEvent: true })).toBe('resize')
    expect(classifyMoveStart({ ...base, programmatic: true, hasOriginalEvent: true })).toBe('program')
  })
  it('originalEvent 가 있으면 user', () => {
    expect(classifyMoveStart({ ...base, hasOriginalEvent: true })).toBe('user')
  })
  it('⌘/Ctrl 휠 299ms 는 user, 301ms 는 program, 기록 없음은 program', () => {
    expect(classifyMoveStart({ ...base, msSinceModWheel: 299 })).toBe('user')
    expect(classifyMoveStart({ ...base, msSinceModWheel: 301 })).toBe('program')
    expect(classifyMoveStart({ ...base, msSinceModWheel: null })).toBe('program')
  })
})

describe('cameraMoved — 변화 없는 easeTo 는 사용자 이동이 아니다', () => {
  const cam = { lat: 37.60395, lng: 127.02915, zoom: 12.96, bearing: 0, pitch: 0 }
  it('Shift+화살표(회전 막힘)·줌 한계 ± 처럼 카메라가 그대로면 false', () => {
    expect(cameraMoved(cam, { ...cam })).toBe(false)
    expect(cameraMoved(cam, { ...cam, lat: cam.lat + 1e-12 })).toBe(false)
  })
  it('중심·줌·방위·기울기 중 하나라도 바뀌면 true', () => {
    expect(cameraMoved(cam, { ...cam, lng: cam.lng + 1e-6 })).toBe(true)
    expect(cameraMoved(cam, { ...cam, lat: cam.lat - 1e-6 })).toBe(true)
    expect(cameraMoved(cam, { ...cam, zoom: 13 })).toBe(true)
    expect(cameraMoved(cam, { ...cam, bearing: 1 })).toBe(true)
    expect(cameraMoved(cam, { ...cam, pitch: 1 })).toBe(true)
  })
  it('시작 스냅샷이 없으면(짝이 안 맞음) 움직인 것으로 본다', () => {
    expect(cameraMoved(null, cam)).toBe(true)
  })
})

describe('areaErrorRetryable — 막대의 다시 시도', () => {
  it('네트워크·타임아웃·5xx·429 는 다시 시도, 422(client)·취소·해석 실패는 아니다', () => {
    for (const k of ['network', 'timeout', 'server', 'ratelimit']) expect(areaErrorRetryable(k), k).toBe(true)
    for (const k of ['client', 'canceled', 'parse', 'unknown']) expect(areaErrorRetryable(k), k).toBe(false)
  })
})

describe('settleAfterRequest', () => {
  it('요청 뒤 사용자 이동이 없으면 none, 있으면 user 유지', () => {
    expect(settleAfterRequest('user', 3, 3)).toBe('none')
    expect(settleAfterRequest('user', 3, 4)).toBe('user')
    expect(settleAfterRequest('program', 3, 4)).toBe('program')
  })
})

describe('areaControlState 진리표', () => {
  const s = (
    lastMove: LastMove,
    gate: AreaGate = 'ok',
    over: Partial<{ mapFailed: boolean; requestPending: boolean; sameAsShown: boolean }> = {},
  ) =>
    areaControlState({
      mapFailed: false,
      requestPending: false,
      sameAsShown: false,
      lastMove,
      gate,
      ...over,
    })
  it('프로그램 이동·처음은 숨김', () => {
    expect(s('none')).toBe('hidden')
    expect(s('program')).toBe('hidden')
  })
  it('사용자 이동 + 게이트', () => {
    expect(s('user')).toBe('button')
    expect(s('user', 'too_wide')).toBe('zoom_in')
    expect(s('user', 'outside')).toBe('outside')
    expect(s('user', 'invalid')).toBe('hidden')
    expect(s('user', 'ok', { sameAsShown: true })).toBe('hidden')
  })
  it('요청 대기 중이면 loading, 요청 뒤 사용자 이동이 있으면 다시 button', () => {
    expect(s('none', 'ok', { requestPending: true })).toBe('loading')
    expect(s('user', 'ok', { requestPending: false })).toBe('button')
  })
  it('지도 실패면 언제나 숨김', () => {
    expect(s('user', 'ok', { mapFailed: true, requestPending: true })).toBe('hidden')
  })
})

describe('toAreaBounds · sameBounds', () => {
  it('소수 6자리로 반올림', () => {
    const b = toAreaBounds({ lat: 37.12345649, lng: 127.9999996 }, { lat: 37.2, lng: 128.0000004 })
    expect(b).toEqual({ min_lat: 37.123456, min_lon: 128.0, max_lat: 37.2, max_lon: 128.0 })
  })
  it('허용오차 5e-6 안이면 같다', () => {
    expect(sameBounds(A, { ...A, min_lat: A.min_lat + 4e-6 })).toBe(true)
    expect(sameBounds(A, { ...A, min_lat: A.min_lat + 1e-5 })).toBe(false)
    expect(sameBounds(A, null)).toBe(false)
  })
})

describe('areaSectionPlan 행렬', () => {
  const ok = (total: number, areas: UnlocatedArea[] = []) => ({ status: 'ok' as const, total, areas })
  const failed = { status: 'failed' as const }

  it('A2형: 이용권 0·위치 미상 없음 + 공공 1 → 이용권 일반 안내', () => {
    const p = areaSectionPlan(ok(0), ok(1))
    expect(p.voucher.kind).toBe('zero+guide')
    expect(p.public.kind).toBe('rows')
    expect(p.neutral).toBe(false)
  })
  it('둘 다 0·위치 미상 없음 → neutral', () => {
    expect(areaSectionPlan(ok(0), ok(0)).neutral).toBe(true)
  })
  it('이용권 실패 + 공공 0 → 이용권 failed, 공공 zero, 안내 없음, neutral 아님', () => {
    const p = areaSectionPlan(failed, ok(0))
    expect(p.voucher).toEqual({ kind: 'failed', unlocated: false })
    expect(p.public).toEqual({ kind: 'zero', unlocated: false })
    expect(p.neutral).toBe(false)
  })
  it('이용권 0 + 위치 미상 → zero+unlocated · 행이 있어도 위치 미상 블록', () => {
    expect(areaSectionPlan(ok(0, [area('48120', '창원시', 638)]), ok(3)).voucher).toEqual({
      kind: 'zero+unlocated',
      unlocated: true,
    })
    expect(areaSectionPlan(ok(2, [area('11290', '성북구', 4)]), ok(3)).voucher).toEqual({
      kind: 'rows',
      unlocated: true,
    })
  })
})

describe('문구', () => {
  it('program 별 noun', () => {
    expect(programNoun('svoucher', 'short')).toBe('이용권 가맹')
    expect(programNoun('svoucher', 'long')).toBe('이용권 가맹시설')
    expect(programNoun('dvoucher', 'short')).toBe('장애인 가맹')
    expect(programNoun('dvoucher', 'long')).toBe('장애인 가맹시설')
    expect(programNoun('public', 'short')).toBe('공공·대안')
    expect(programNoun('public', 'long')).toBe('공공·대안 시설')
  })
  it('쉼표 숫자 · 제목 · q', () => {
    expect(countText(1234)).toBe('1,234곳')
    expect(barTitle(true)).toBe('이 지도 범위')
    expect(barTitle(false)).toBe('찾았던 범위')
    expect(qIncludedText('수영')).toBe('‘수영’ 포함')
    expect(dropQText('수영')).toBe('‘수영’ 빼고 다시 찾기')
  })
  it('막대 숫자 — 합계 없이 program 별 · 실패한 쪽은 확인 실패', () => {
    expect(barCounts('svoucher', { status: 'ok', total: 1234 }, { status: 'ok', total: 3 })).toBe(
      '이용권 가맹 1,234곳 · 공공·대안 3곳',
    )
    expect(barCounts('dvoucher', { status: 'failed' }, { status: 'ok', total: 3 })).toBe(
      '장애인 가맹 확인 실패 · 공공·대안 3곳',
    )
  })
  it('위치 미상 제목 — 1곳·k곳, q 포함', () => {
    const one = [area('48120', '창원시', 638)]
    expect(unlocatedHeadline('svoucher', one, null, 'block')).toBe(
      '창원시 이용권 가맹시설 638곳은 정확한 위치를 확인할 수 없어 지도에 없어요',
    )
    expect(unlocatedHeadline('svoucher', one, null, 'bar')).toBe(
      '창원시 이용권 가맹시설 638곳은 정확한 위치를 확인할 수 없어 지도에 없어요 · 시군구 전체 수',
    )
    const two = [area('28237', '부평구', 283), area('28245', '계양구', 169)]
    expect(unlocatedHeadline('svoucher', two, '수영', 'block')).toBe(
      '시군구 2곳의 이용권 가맹시설 ‘수영’ 포함 452곳은 정확한 위치를 확인할 수 없어 지도에 없어요',
    )
    expect(unlocatedHeadline('svoucher', two, '수영', 'bar')).toBe(
      '부평구 등 시군구 2곳의 이용권 가맹시설 ‘수영’ 포함 452곳은 정확한 위치를 확인할 수 없어 지도에 없어요 · 시군구 전체 수',
    )
  })
  it('일반 안내 · 섹션 0건 · 실패 · 부분 실패', () => {
    expect(voucherGuide('dvoucher')).toContain('장애인 가맹시설은')
    expect(voucherGuide('svoucher')).toBe('이용권 가맹시설은 대부분 정확한 위치가 없어 지도 범위로는 찾기 어려워요')
    expect(sectionZeroText('public')).toBe('위치가 확인된 공공·대안 시설 0곳')
    expect(sectionFailedText('svoucher')).toBe('이용권 가맹시설을 확인하지 못했어요')
    expect(partialText('dvoucher', 'voucher')).toBe('장애인 가맹시설 찾기가 실패해 공공·대안 시설만 보여요.')
    expect(partialText('svoucher', 'public')).toBe('공공·대안 시설 찾기가 실패해 이용권 가맹시설만 보여요.')
  })
  it('검색 범위 덮어쓰기 — 검색어 전 안내(내 지역 목록을 그 시군구 결과처럼 두지 않는다)', () => {
    expect(scopeOverridePrompt('서대문구')).toBe(
      '서대문구 안에서 찾을 시설 이름이나 주소를 입력해 주세요 · 내 지역 근처 목록은 ‘내 지역으로’를 누르면 다시 보여요',
    )
  })
  it('완료 낭독', () => {
    const v = { status: 'ok' as const, total: 0, areas: [area('11290', '성북구', 4)] }
    const p = { status: 'ok' as const, total: 3, areas: [] }
    expect(doneAnnouncement('svoucher', v, p)).toBe(
      '이 지도 범위: 이용권 가맹 0곳, 공공·대안 3곳 찾음 · 위치 확인 안 된 이용권 가맹시설 4곳은 시군구 전체 수로 따로 안내',
    )
    expect(doneAnnouncement('svoucher', { status: 'failed' }, p)).toBe(
      '이 지도 범위: 공공·대안 3곳 찾음 · 이용권 가맹 확인 실패',
    )
  })
})

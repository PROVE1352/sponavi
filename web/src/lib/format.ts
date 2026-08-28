// 표기 헬퍼

// CQ1A: 결측(null)과 0은 다른 뜻이다 — null 은 "값을 모른다"(미등록), 0 은 "무료".
// 없는 값을 0원·무료로 채우지 않는다(P-1).
export function won(n: number | null): string {
  if (n == null) return '미등록·시설 문의'
  if (n <= 0) return '무료'
  return n.toLocaleString('ko-KR') + '원'
}

export function wonPlain(n: number): string {
  return n.toLocaleString('ko-KR') + '원'
}

export function km(n: number): string {
  return `${n.toFixed(1)}km`
}

// 도보 분(약 4km/h → 15분/km)
export function walkMinutes(distKm: number): number {
  return Math.max(1, Math.round(distKm * 15))
}

export function percent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

export type MarkerKind = 'voucher' | 'dvoucher' | 'public'

export function markerColor(kind: MarkerKind | 'disability'): string {
  switch (kind) {
    case 'voucher':
      return 'var(--color-marker-voucher)'
    case 'dvoucher':
    case 'disability':
      return 'var(--color-marker-disability)'
    case 'public':
    default:
      return 'var(--color-marker-public)'
  }
}

// C-5: 원천 제목의 변형 번호 꼬리("교차윗몸일으키기-1", "..._2")는 사람에게 보여 줄
// 이름이 아니라 소스의 파일 번호다. 표시용으로만 떼어내고 원문(data-*/alt)은 그대로 남긴다.
// 판단 없이 문자열만 다듬는다 — 서버 데이터는 건드리지 않는다(P-2).
export function displayTitle(raw: string): string {
  const trimmed = raw.trim()
  const stripped = trimmed.replace(/[-_]\d+$/, '').trim()
  return stripped === '' ? trimmed : stripped
}

// 꼬리를 뗀 이름이 겹치면 사라진 구분을 되살린다 — 두 번째부터 "(2)", "(3)".
// 정보를 지우지 않으면서 카드끼리 구별되게 하는 최소 장치.
export function dedupeDisplayTitles(raws: string[]): string[] {
  const seen = new Map<string, number>()
  return raws.map((raw) => {
    const name = displayTitle(raw)
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    return n === 1 ? name : `${name} (${n})`
  })
}

// 요일 마스크(월화수목금토일) → "월·수·금"
const DAYS = ['월', '화', '수', '목', '금', '토', '일']
export function weekdays(mask: string): string {
  return DAYS.filter((_, i) => mask[i] === '1').join('·')
}

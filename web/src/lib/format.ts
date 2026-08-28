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

// 요일 마스크(월화수목금토일) → "월·수·금"
const DAYS = ['월', '화', '수', '목', '금', '토', '일']
export function weekdays(mask: string): string {
  return DAYS.filter((_, i) => mask[i] === '1').join('·')
}

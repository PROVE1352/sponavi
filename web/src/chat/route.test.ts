// 해시 라우트 파싱(OV10) — QR/딥링크 `/demo?p=P2` 는 서버가 `/#/demo?p=P2` 로 보낸다.
import { describe, expect, it } from 'vitest'
import { parseDemoHash } from './route'

describe('parseDemoHash', () => {
  it('쿼리 없는 #/demo 는 데모 페이지(옵션 없음)', () => {
    expect(parseDemoHash('#/demo')).toEqual({ demo: true, p: null, auto: false })
    expect(parseDemoHash('#/demo/')).toEqual({ demo: true, p: null, auto: false })
  })

  it('해시 안의 쿼리에서 p·auto 를 읽는다', () => {
    expect(parseDemoHash('#/demo?p=P2&auto=1')).toEqual({ demo: true, p: 'P2', auto: true })
    expect(parseDemoHash('#/demo?p=P5')).toEqual({ demo: true, p: 'P5', auto: false })
  })

  it('빈 p·auto=0 은 옵션 없음으로 본다(추측 금지)', () => {
    expect(parseDemoHash('#/demo?p=&auto=0')).toEqual({ demo: true, p: null, auto: false })
  })

  it('데모 라우트가 아닌 해시는 전부 false — 앵커(#top)도 포함', () => {
    expect(parseDemoHash('#top')).toEqual({ demo: false, p: null, auto: false })
    expect(parseDemoHash('')).toEqual({ demo: false, p: null, auto: false })
    expect(parseDemoHash('#/demolition?p=P2')).toEqual({ demo: false, p: null, auto: false })
  })
})

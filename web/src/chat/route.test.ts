// 해시 라우트 파싱(OV10) — QR/딥링크 `/demo?p=P2` 는 서버가 `/#/demo?p=P2` 로 보낸다.
import { describe, expect, it } from 'vitest'
import { parseDemoHash } from './route'
import { ruleIntent } from './policy'

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

// 규칙 의도(FR-08 AC8) — LLM 이 꺼져 있어도 "왜 이 운동?"은 잡아야 한다.
// 서버 chat.py 의 같은 정규식과 짝이므로 양성·음성을 함께 고정한다.
describe('ruleIntent', () => {
  it.each([
    '왜 이 운동 추천했어?',
    '왜 그 운동이야',
    '왜 추천했는지 알려줘',
    '추천 근거가 뭐야',
    '추천 이유 알려주세요',
    '근거 알려줘',
    '근거 뭐야',
  ])('근거를 묻는 발화는 why_exercise: %s', (t) => {
    expect(ruleIntent(t)).toBe('why_exercise')
  })

  it.each([
    '성북구에 살아요',
    '27살이에요',
    '이용권 누가 받아요?',
    '운동 추천해줘',
    '지도 보여줘',
  ])('그 밖의 발화는 잡지 않는다: %s', (t) => {
    expect(ruleIntent(t)).toBeNull()
  })
})

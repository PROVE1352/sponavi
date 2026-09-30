// 데스크톱(lg) 컨텍스트 패널의 지도 탭 — 범위 모드의 결과 막대 칸 높이 한도(순수 함수, vitest 대상).
//
// 패널은 lg:sticky(top = 헤더 높이)다. 범위 결과 막대(지도 아래 약 190~290px)가 붙어 패널이 "쓸 수 있는 높이"보다
// 길어지면, 대화 바닥에서 sticky 패널이 컨테이너 바닥에 밀려 위로 올라가 지도·탭·"이 지역에서 다시 찾기"가 헤더 밑으로
// 들어간다. 그래서 **막대 칸만** 스스로 스크롤하게 하고(지도·범례는 칸 밖 — 칸에 스크롤바가 생겨도 지도 폭이 변하지
// 않는다), 그 칸의 한도를 실제 배치에서 잰다:
//
//   한도 = 뷰포트 높이 − sticky top − 컨테이너 아래(데모 푸터) − 칸 위(패널 머리·지도·범례) − 칸 아래(탭패널 여백)
//
// 고정 calc(100dvh − 16rem) 은 "글씨 크게"(루트 19px)에서 304px 로 불어나 실제 머리보다 크고, 데모 푸터는 모른다.
// 한도가 너무 작으면(짧은 화면 + 글씨 크게) 막대 첫 줄 정도는 보이게 최소값을 둔다 — 그만큼은 패널이 밀릴 수 있다.

export interface StickyFit {
  viewportH: number
  stickyTop: number
  // 컨테이너(패널의 부모) 아래에 붙은 문서 높이 — 데모 페이지 푸터. 대화 바닥에서 이만큼 컨테이너가 위로 끝난다.
  belowContainer: number
  // 패널 윗변 ~ 막대 칸 윗변(패널 머리 + 탭 + 지도 + 범례)
  above: number
  // 막대 칸 아랫변 ~ 패널 아랫변(탭패널 아래 여백)
  below: number
  minPx: number
}

export function stickyRegionMaxHeight(x: StickyFit): number {
  const avail = x.viewportH - x.stickyTop - Math.max(0, x.belowContainer) - x.above - x.below
  return Math.max(Math.round(x.minPx), Math.floor(avail))
}

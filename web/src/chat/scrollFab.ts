// "맨 아래로" 버튼(FAB)의 노출 판정. 컴포넌트에서 떼어 둔 순수 함수다 —
// 위치를 재는 건 브라우저가 하고, "그래서 보여 줄 것인가"만 여기서 정한다(단위 테스트 대상).

// 문서 바닥까지 남은 거리가 이보다 크면 버튼이 나타난다.
// 160px ≈ 폰에서 한 번 굴린 거리. 더 낮추면 버블 하나 자랄 때마다 깜빡이고,
// 더 높이면 카드 CTA("지도에서 보기")로 올라간 사용자가 버튼을 못 본다.
// ※ 스트림의 바닥 추종 임계(STICK_THRESHOLD_PX)와 같은 값이다 —
//   "바닥에 붙어 있다"고 보는 범위와 "버튼을 감춘다"는 범위가 어긋나면
//   버튼이 떠 있는데 이미 바닥 추종 중인 어정쩡한 구간이 생긴다.
export const FAB_GAP_PX = 160

// gap = scrollHeight - (scrollY + innerHeight). 0 = 문서 바닥에 붙음.
// 고무줄 스크롤(iOS)에서 gap 이 음수로 튀거나 NaN 이 오면 "바닥"으로 본다.
export function fabVisible(gap: number, threshold: number = FAB_GAP_PX): boolean {
  return Number.isFinite(gap) && gap > threshold
}

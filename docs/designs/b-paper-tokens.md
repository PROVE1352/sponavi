# B · 종이 메모 — 코드 이식 스펙 (2026-08-28)

캔버스: https://claude.ai/code/artifact/a329d72f-a8a1-4097-a8d3-a0cd7095f412 (1페이지 B 다섯 장이 기준: 채팅·판정·체력·시설 패널·gap)
작업 파일: `docs/designs/canvas/Main*.dc.html` — 인라인 스타일의 값이 곧 스펙.

## 토큰 (index.css `@theme` 에 추가/교체)
| 이름 | 값 | 용도 |
|---|---|---|
| paper | `#f7f3ea` | 페이지 배경 (slate-50 대체) |
| ink | `#1f2a44` | 본문·헤딩·굵은 괘선·채운 버튼 |
| mute | `#6b6357` | 보조 텍스트 (slate-600 대체) |
| rule | `#d9d0c1` | 1px 괘선·점선 |
| tint | `#ebe4d4` | 사용자 답 블록·강조 박스 배경 |
| accent(인주) | `#c0532b` | 해당 없음·"N가지"·행동 링크·전환 후보 — 화면당 한두 군데 |
| ok | `#3d6b3a` | 공식 확인·확대 후보 |
| 다크 | paper `#17171a`, ink `#ece6d8`, mute `#a39c8e`, rule `#3a3833`, tint `#24231f`, accent `#e2764d`, ok `#7fb37a` | `.dark` 변형 (기존 다크 토글 유지) |

폰트(자체 호스팅, `web/public/fonts/`, OFL): 헤딩 `'Nanum Myeongjo'` 800 (`NanumMyeongjo-ExtraBold.woff2`), 본문 `'Gowun Dodum'` (`GowunDodum-Regular.woff2`), 폴백 `'Apple SD Gothic Neo','Noto Sans KR',sans-serif`. Atkinson Hyperlegible 은 숫자·라틴 보조로 유지해도 됨(스택 뒤로).

## 컴포넌트 규칙
- **카드·그림자·알약·배지 금지.** 경계는 괘선으로만: 큰 전환 = `2px solid ink`, 항목 = `1px dashed rule`, 목록 행 = `1px solid rule`. radius ≤ 3px (컴포저 전송 원형 버튼만 예외).
- **헤더**: 명조 22px 800 "스포내비" + 12px mute 부제, 아래 2px ink 괘선. 우측 "처음부터" 밑줄 텍스트 버튼(다크 토글은 아이콘/텍스트 링크로 축소).
- **봇 발화**: 말풍선 없음. 왼쪽 본문 16px/1.7 ink. 봇 턴 첫 문장 위에만 11px 자간 0.14em mute "스포내비" 라벨. 보조문(개인정보 고지)은 12.5px mute.
- **사용자 답**: 오른쪽 정렬, `tint` 배경, radius 3, 7px 12px, 15px.
- **답 고르는 칩**(연령·성별·지역·소득·장애 등): 40px 이상, `1.5px solid ink` 네모 radius 3, 고른 것은 ink 채움 + paper 글자.
- **행동 칩**(지도·목록·체력·처음부터): 밑줄 텍스트 버튼(accent, 강조 항목은 ink 700), 44px 높이 유지. **FAQ 칩도 행동 칩과 같은 밑줄 스타일.**
- **판정 카드 → 섹션**: 제도명 명조 18px 800 + 우측 `✗ 해당 없음`(accent 700) / `✓ 예상 자격`(ok). 사유 13.5px mute. 출처는 `출처`(자간 0.12em) + 값 12px mute.
- **히어로**(지금 바로 되는 것): 명조 24px 800, "N가지"만 accent. 항목은 ①② accent 명조 20px 왼쪽 열 + 제목 명조 17px + 설명 13.5px mute + 링크. "확인 중 N건"은 ※ 각주 12.5px. CTA = ink 채운 full-width 52px, 명조 16px 800, 우측 셰브론.
- **근처 강좌**: 번호 열(12px mute) + 이름 16px 700 + 부제 13px mute + 우측 거리 13px mute, 행 사이 1px rule.
- **체력 판정**: 항목 = 왼쪽 78px 등급 라벨(12px 700; 기준 미달은 accent) + 문장 14px. 참고 등급 박스는 tint 배경 radius 3. 추천 종목 행은 점선, 근거 배지는 텍스트(ok 체크 / mute "검증 중"). 영상 카드는 16:9 tint 박스 + 13px 제목 + 11px mute.
- **시설 패널**: 탭은 명조 16px 텍스트 + 활성 2.5px ink 밑줄. 필터 칩은 답 칩과 동일(선택 시 채움). 행은 이름/거리 + 유형·종목 + 요금 + 접근성 태그(1px rule 테두리 radius 2, 11.5px).
- **컴포저**: 입력은 밑줄만(`1.5px solid ink`), 전송은 ink 원형 44px 화살표.
- **FAB(맨 아래로)**: ink 원형 44px, paper 화살표, 그림자 없음(1px rule 테두리 허용).
- **자동재생 알약, 로딩, 에러 패널**: 같은 규칙(테두리 1px rule, radius 3, 배경 tint/paper).

## 손대지 않는 것
data-testid, 문구, 레인 분리 로직, 접근성 속성(aria), 44px 터치 타깃, 색맹 안전(아이콘+텍스트 병기).

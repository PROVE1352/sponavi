"""Demo personas (SPEC §5). GET /api/demo/personas returns these.

Each element carries button metadata (id/label/expected) plus `body`, the exact
POST /api/assess request payload. Location is omitted so the server exercises the
sigungu-centroid fallback (SPEC §2).

`demo` (결정 3A) — 자동재생이 소비하는 프리필 계약. 두 키를 항상 싣는다:
  * `fitness`: POST /api/fitness 의 `measures` 로 그대로 넣는 값 dict, 또는 None.
    항목 코드는 `/api/fitness/items` 카탈로그 기준(악력은 kg 가 아니라 `grip_rel` %).
    값은 실 DB `fitness_norm` 연령·성별 컷 실측이며, 약점이 정확히 1건(근지구력)
    나오도록 골랐다 — 데모가 매번 같은 이야기를 하게 하기 위함이다.
  * `parq_preset`: PAR-Q 문진을 데모용으로 미리 채울지. 채운 화면에는
    "데모 페르소나 문진 프리셋 — 실사용은 직접 확인" 라벨이 붙는다(P-1).
값이 없는 페르소나는 `{"fitness": None, "parq_preset": False}` 로 명시한다(키 생략 아님).

P4 is CONFIRMED as "72세 청각장애(연령 초과)": dvoucher is 소득무관(no income gate)
and its age ceiling is 69 (verified 2026-07-20, data/rules.json sources).
"""

PERSONAS = [
    {
        "id": "P1",
        "label": "10세 여 · 기초수급 · 성북구 · 비장애",
        "expected": "스포츠강좌이용권 예상 자격 ✓ → 신청안내 + 근처 가맹시설·자부담 계산",
        "body": {
            "age": 10, "sex": "F",
            "sigungu_cd": "11290", "sigungu_nm": "성북구",
            "income_class": "기초생활수급",
            "disability": {"has": False, "type": None},
        },
        "demo": {"fitness": None, "parq_preset": False},
    },
    {
        "id": "P2",
        "label": "27세 남 · 그 외(낀 계층) · 성북구 · 비장애",
        "expected": "이용권 ✗(소득) → 대체경로 → 공공체육시설 + 체력처방 결합",
        "body": {
            "age": 27, "sex": "M",
            "sigungu_cd": "11290", "sigungu_nm": "성북구",
            "income_class": "그외",
            "disability": {"has": False, "type": None},
        },
        # 25~29세 남 기준표 실측(fitness_norm) — crunch_cross 35 는 3등급 컷 38 미달로
        # 근지구력 약점 1건만 만들고, 나머지 4항목은 등급 안에 든다.
        "demo": {
            "fitness": {
                "crunch_cross": 35, "shuttle_20m": 42, "sit_reach": 6, "grip_rel": 58,
                "height_cm": 175, "weight_kg": 72,
            },
            "parq_preset": True,
        },
    },
    {
        "id": "P3",
        "label": "14세 여 · 차상위 · 지체장애 · 성북구",
        "expected": "장애인스포츠강좌이용권 예상 자격 ✓ · 예상 1순위(차상위·청소년) → 성북구 장애인 가맹 41곳을 접근성 태그(지원 유형·편의시설)로 고르기",
        "body": {
            "age": 14, "sex": "F",
            "sigungu_cd": "11290", "sigungu_nm": "성북구",
            "income_class": "차상위",
            "disability": {"has": True, "type": "지체"},
        },
        "demo": {"fitness": None, "parq_preset": False},
    },
    {
        "id": "P4",
        "label": "72세 남 · 청각장애 · 강원 고성군 (연령 초과)",
        "expected": "장애인스포츠강좌이용권 ✗(연령 5~69세 초과) → 장애 특화 대체경로 + 공급공백 신호(고성군 장애인 가맹 0곳 · 최근접 속초시)",
        # PRD ★FR-P4: 데모 지역은 인천 서구(28260). 커버리지(수급률)는 서울 15구만
        # 실측이라 이 구는 coverage=null 로 나온다 — 없는 통계를 만들지 않는다(P-1).
        "body": {
            "age": 72, "sex": "M",
            "sigungu_cd": "51820", "sigungu_nm": "고성군",
            "income_class": "그외",
            "disability": {"has": True, "type": "청각"},
        },
        "demo": {"fitness": None, "parq_preset": False},
    },
    {
        "id": "P5",
        "label": "32세 남 · 지체장애 · 비저소득 · 성북구",
        "expected": "장애인스포츠강좌이용권 자격 ✓(신청은 소득무관) — 단 예상 5순위(성인·비저소득)라 선정 대기 가능 → '지금 바로 되는 것' 대체경로",
        "body": {
            "age": 32, "sex": "M",
            "sigungu_cd": "11290", "sigungu_nm": "성북구",
            "income_class": "그외",
            "disability": {"has": True, "type": "지체"},
        },
        # 30~34세 남 기준표 실측 — crunch_cross 33 은 3등급 컷 35 미달(근지구력 1건),
        # 나머지는 등급 안(shuttle_20m 2등급·sit_reach 3등급·grip_rel 3등급·BMI 건강범위).
        "demo": {
            "fitness": {
                "crunch_cross": 33, "shuttle_20m": 40, "sit_reach": 6, "grip_rel": 56,
                "height_cm": 174, "weight_kg": 73,
            },
            "parq_preset": True,
        },
    },
]

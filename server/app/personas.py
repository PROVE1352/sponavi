"""Demo personas (SPEC §5). GET /api/demo/personas returns these.

Each element carries button metadata (id/label/expected) plus `body`, the exact
POST /api/assess request payload. Location is omitted so the server exercises the
sigungu-centroid fallback (SPEC §2).

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
    },
    {
        "id": "P3",
        "label": "14세 여 · 차상위 · 지체장애 · 성북구",
        "expected": "장애인스포츠강좌이용권 예상 자격 ✓ (단, 성북구 가맹시설 0 → 공급공백 신호 + 접근성 공공대안)",
        "body": {
            "age": 14, "sex": "F",
            "sigungu_cd": "11290", "sigungu_nm": "성북구",
            "income_class": "차상위",
            "disability": {"has": True, "type": "지체"},
        },
    },
    {
        "id": "P4",
        "label": "72세 남 · 청각장애 · 성북구 (연령 초과)",
        "expected": "장애인스포츠강좌이용권 ✗(연령 5~69세 초과) → 장애 특화 대체경로 + 공급공백 신호",
        "body": {
            "age": 72, "sex": "M",
            "sigungu_cd": "11290", "sigungu_nm": "성북구",
            "income_class": "그외",
            "disability": {"has": True, "type": "청각"},
        },
    },
]

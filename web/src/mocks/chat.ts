// 목모드 챗 데이터. 자유 텍스트(NLU)는 목모드에서 호출하지 않으므로(칩 모드 강등),
// 여기 있는 건 FAQ 사전뿐이다 — 답변 본문은 data/rules.json 의 verified 값에서 그대로 옮겨온
// 문장이며 새로 지어내지 않는다(SPEC §0-5 날조 금지 · API.md GET /api/chat/faq).

import type { ChatNluResponse, FaqEntry } from '../types_chat'

export const MOCK_FAQ: FaqEntry[] = [
  {
    key: 'dvoucher_income',
    q: '장애인 이용권도 소득 기준이 있나요?',
    answer:
      '장애인스포츠강좌이용권은 소득과 관계없이 신청할 수 있습니다. 다만 선정은 우선순위제라, 예산에 따라 대기가 생길 수 있습니다.',
    source_url: 'https://dvoucher.kspo.or.kr',
    checked: '2026-07-20',
  },
  {
    key: 'svoucher_target',
    q: '스포츠강좌이용권은 누가 받을 수 있나요?',
    answer:
      '스포츠강좌이용권은 기초생활수급·차상위·한부모가족 등 소득 지원 대상 유청소년이 신청 대상입니다. 최종 자격은 공식 신청처에서 확인됩니다.',
    source_url: 'https://svoucher.kspo.or.kr',
    checked: '2026-07-20',
  },
  {
    key: 'income_check',
    q: '기초·차상위인지 어떻게 확인하나요?',
    answer:
      '복지로의 복지서비스 모의계산으로 대략 확인할 수 있고, 주민센터에서 수급자·차상위 확인서 발급 여부로 확정할 수 있습니다.',
    source_url: 'https://www.bokjiro.go.kr',
    checked: '2026-07-20',
  },
]

// 목모드에서 만에 하나 NLU 경로가 호출되어도 LLM 인 척 하지 않는다 — rules 폴백 형태.
export const MOCK_NLU_RULES: ChatNluResponse = {
  slot_updates: {},
  intent: 'unknown',
  faq_key: null,
  region_candidates: [],
  reply: null,
  provider: 'rules',
}

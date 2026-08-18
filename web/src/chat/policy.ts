// 결정론 대화 정책 (FR-12 · ARCHITECTURE §11.1).
//
//   [칩 입력] → 여기서 슬롯을 직접 갱신 — LLM 0회 · 챗 엔드포인트 무호출
//   [슬롯 완성] → /api/assess → 판정 카드 메시지들
//
// 이 파일이 소유하는 것: 질문 순서 · 칩 정의 · 봇 발화 템플릿.
// 봇의 사실 문장(자격·금액·시설·거리·순위)은 전부 이 템플릿 + 엔진 출력이다(FR-12 AC2).
// 카피는 PRD §6 정직성 표기 사전을 따른다 — "예상 자격", 단정 금지.

import type {
  AssessRequest,
  AssessResponse,
  DemoPersona,
  DisabilityType,
  IncomeClass,
  LatLon,
  Sex,
  Sigungu,
} from '../types'
import type { Chip, ChatSlots, ChipQuestionMsg, QuestionId, RegionCandidate } from '../types_chat'

// ────────────────────────────── 상수(구 ResultView 소유분 이주) ──────────────────────────────

// 좌표 미상 시 사용하는 기본 위치(서울시청). 지도 중심용일 뿐 거리 주장에 쓰지 않는다.
export const DEFAULT_PERSON_LOC: LatLon = { lat: 37.5665, lon: 126.978 }

export function personLocOf(req: AssessRequest): LatLon {
  return req.location ?? DEFAULT_PERSON_LOC
}

// alt_edges(복수 대체경로)는 주 제도(비장애=svoucher / 장애=dvoucher)에 귀속.
export function primaryProgramId(req: AssessRequest): string {
  return req.disability.has ? 'dvoucher' : 'svoucher'
}

// ────────────────────────────── 선택지 카탈로그 ──────────────────────────────

// 공문서 용어는 첫 등장 시 짧게 풀이한다(PRD §2.5 "쉬운 말").
export const INCOME_OPTIONS: { value: IncomeClass; label: string; hint: string }[] = [
  { value: '기초생활수급', label: '기초생활수급', hint: '생계·의료·주거·교육급여를 받고 있는 경우' },
  { value: '차상위', label: '차상위계층', hint: '기초생활수급 바로 위 소득 구간' },
  { value: '한부모', label: '한부모가정', hint: '한부모가족 지원 대상으로 등록된 경우' },
  { value: '그외', label: '그 외 (해당 없음)', hint: '위 세 가지에 해당하지 않는 경우' },
]

// 법정 유형 명칭 8택(A11Y-5). 세부 등급·진단명은 묻지 않는다.
export const DISABILITY_TYPES: DisabilityType[] = [
  '지체',
  '뇌병변',
  '시각',
  '청각',
  '언어',
  '지적',
  '자폐성',
  '기타',
]

// 나이 질문의 빠른 선택(자유 입력·검색과 병행). 값은 각 구간의 대표 나이가 아니라
// 실제 입력값이므로, 칩은 "대표 연령"이 아니라 정확한 나이를 고르게 하는 보조 수단이다.
const AGE_QUICK: { label: string; age: number }[] = [
  { label: '10세', age: 10 },
  { label: '14세', age: 14 },
  { label: '27세', age: 27 },
  { label: '32세', age: 32 },
  { label: '72세', age: 72 },
]

export const SEX_LABEL: Record<Sex, string> = { F: '여성', M: '남성' }

// ──────────────── 봇 발화 템플릿 (PRD §6 정직성 사전 + §2.5 "나비" 카피 가이드) ────────────────
//
// 화자는 스포내비 안내자 "나비". 담백하고 따뜻한 존댓말(~예요/~해 주세요), 한 버블 1~2문장,
// 본문 텍스트에 이모지 미사용(아바타만 예외). 공문서 용어는 첫 등장 시 짧게 풀이.
// 재촉·과장·동정 어투 금지. ★ 자격·금액·시설·순위의 사실 진술은 나비가 아니라 카드가 한다.

export const BOT_NAME = '나비'

export const T = {
  greet: '안녕하세요, 스포내비 안내자 나비예요.',
  greetSub: '몇 가지만 알려주시면 받으실 수 있는 제도와 근처 시설을 함께 찾아드릴게요.',
  // 비저장 고지 + 외부 AI 전송 고지를 한 구절로 통합(FR-12 AC7 v1.4 · P-3).
  // 컴포저 하단 상시 고지는 삭제되었고, 이 문장이 그 역할을 대신한다 — 인사 버블의 보조 텍스트.
  greetPrivacy:
    '입력하신 내용은 저장하지 않고, 자유 입력 문장은 AI 이해를 위해서만 외부 AI에 전달돼요. 이름·연락처는 묻지 않습니다.',

  askAge: '먼저 나이를 알려주세요. 아래 버튼으로 고르시거나 직접 입력하셔도 돼요.',
  askSex: '성별을 골라 주세요.',
  askRegion: '어느 지역에 사시나요? 아래 검색창에서 찾아 고르실 수 있어요.',
  askIncome: '소득 구분을 골라 주세요. 심사가 아니라 스스로 고르는 항목이고, 저장하지 않아요.',
  askDisability: '장애 등록이 되어 있으신가요?',
  askDisabilityType: '장애 유형을 골라 주세요. 등급이나 진단명은 묻지 않아요.',

  // 소득 "잘 모르겠어요"(FR-12 AC6) — 어떤 기준으로 계산했는지 밝히고 확인 방법을 안내한다.
  incomeUnknownNotice:
    '소득 구분을 모르셔도 괜찮아요. 우선 가장 보수적인 "그 외(해당 없음)" 기준으로 계산할게요.',
  incomeUnknownHow: '기초생활수급·차상위 해당 여부를 확인하는 방법이에요',
  incomeUnknownBullets: [
    '복지로에서 복지서비스 모의계산으로 대략 확인할 수 있어요',
    '주민센터에 문의해 수급자·차상위 확인서 발급이 되는지 확인하실 수 있어요',
    '생계·의료·주거·교육급여를 이미 받고 계시면 해당할 가능성이 있어요',
  ],
  incomeUnknownLinks: [
    { label: '복지로 모의계산 열기', url: 'https://www.bokjiro.go.kr' },
    { label: '정부24 주민센터 찾기', url: 'https://www.gov.kr' },
  ],

  assessing: '알려주신 내용으로 확인하고 있어요.',

  // 데모 페이지(/#/demo) 전용 안내. 메인(실사용 랜딩)에는 나오지 않는다(FR-12 AC5 v1.4).
  demoIntro: '여기는 시연용 데모 페이지예요.',
  demoQuickStart: '아래 상황 중 하나로 바로 체험해 보시거나, 직접 입력하실 수 있어요.',

  // LLM 강등 정직 라벨(PRD §6 사전 문구 그대로 · FR-12 AC4). AI인 척 하지 않는다.
  degraded: '지금은 규칙 기반 모드예요 — 버튼으로 선택해 주세요.',
  degradedChips: '아래 버튼으로 골라 주시면 그대로 이어서 안내해 드릴게요.',

  restartConfirm: '처음부터 다시 시작할까요? 지금까지 고르신 내용은 지워져요.',
  restartKeep: '그대로 이어서 진행할게요.',
  restarted: '처음부터 다시 시작할게요.',

  mapOpened: '지도와 시설 목록을 패널에 열어 두었어요. 접기 버튼으로 다시 접으실 수 있어요.',
  mapNeedsResult: '지도는 먼저 몇 가지를 알려주신 뒤에 보여드릴 수 있어요.',

  // 체력 레인 3턴(PAR-Q → 측정 폼 → 결과). 안내만 하고, 문진·판정·처방의 내용은 카드가 말한다.
  fitnessIntro: '체력 처방을 함께 해볼게요. 먼저 아래 문진만 확인해 주세요.',
  fitnessFormIntro: '이제 측정값을 넣어 주세요. 아는 항목만 넣으셔도 괜찮아요.',
  fitnessResultIntro: '아래 카드에 판정과 추천을 정리해 두었어요.',
  fitnessAlready: '체력 처방은 위 카드에서 이어서 하실 수 있어요.',
  fitnessNeedsResult: '체력 처방은 예상 자격을 먼저 확인한 뒤에 이어서 하실 수 있어요.',
  fitnessFilterApplied: '고르신 종목만 남겨서 시설 목록을 옆 패널에 열어 두었어요.',

  followUpPrompt: '더 필요하신 게 있으면 아래에서 골라 주세요.',

  faqEmpty: '그 질문은 아직 확인된 답변을 준비하지 못했어요. 공식 신청처에서 확인해 주시면 정확해요.',

  unknownInLlm: '제가 잘 이해하지 못했어요. 아래 버튼으로 골라 주시면 정확하게 안내해 드릴게요.',

  privacyNote: '대화 내용은 이 브라우저에만 남고 서버에 저장되지 않아요.',
} as const

// 판정 결과 안내 멘트. ★ 사실(자격·금액·순위)은 아래 카드가 말한다 — 나비는 안내만 한다.
export function verdictText(req: AssessRequest, data: AssessResponse): string {
  const anyOk = data.eligibility.some((e) => e.eligible)
  const who = `${req.sigungu_nm} · ${req.age}세 ${SEX_LABEL[req.sex]}${
    req.disability.has ? ` · ${req.disability.type ?? ''}장애` : ''
  }`
  return anyOk
    ? `${who} 기준으로 확인했어요. 아래 카드에 예상 자격과 신청 방법을 정리해 두었어요.`
    : `${who} 기준으로 확인했어요. 아래 카드에 그 이유와 지금 이용하실 수 있는 다른 길을 함께 담았어요.`
}

// 근처 자원 안내 멘트. 시설 수·거리 같은 사실은 아래 카드가 표시한다(FR-04 AC2 문구 규칙 포함).
export function facilitySummaryText(): string {
  return '근처에서 이용하실 수 있는 곳도 정리해 두었어요. 지도로 보시려면 아래 버튼을 눌러 주세요.'
}

export function personaEchoText(p: DemoPersona): string {
  const dis = p.disability.has ? `${p.disability.type ?? ''}장애` : '비장애'
  return `${p.id} 상황으로 함께 살펴볼게요. ${p.age}세 ${SEX_LABEL[p.sex]} · ${p.sigungu_nm} · ${p.income_class} · ${dis}로 확인해요.`
}

// NLU 가 슬롯을 갱신했을 때의 에코 문구(정정 칩과 함께).
export const SLOT_ECHO_PROMPT = '이렇게 이해했어요. 다르면 눌러서 고쳐 주세요.'
export const REGION_AMBIGUOUS_PROMPT = '같은 이름의 지역이 여러 곳이에요. 어디신가요?'

// ────────────────────────────── 질문 → 칩 ──────────────────────────────

export function ageChips(): Chip[] {
  return AGE_QUICK.map((a) => ({
    id: `age-${a.age}`,
    label: a.label,
    action: { kind: 'answer', question: 'age', slots: { age: a.age } },
  }))
}

export function sexChips(): Chip[] {
  return (['F', 'M'] as Sex[]).map((s) => ({
    id: `sex-${s}`,
    label: SEX_LABEL[s],
    action: { kind: 'answer', question: 'sex', slots: { sex: s } },
  }))
}

// 지역: 전국 시군구 목록에서 검색해 고른다(FR-12 AC6 "검색 가능 선택지").
export function regionChips(list: Sigungu[], limit = 12): Chip[] {
  return list.slice(0, limit).map((s) => ({
    id: `region-${s.cd}`,
    label: s.nm,
    action: {
      kind: 'answer',
      question: 'region',
      slots: { sigungu_cd: s.cd, sigungu_nm: s.nm },
    },
  }))
}

export function regionCandidateChips(cands: RegionCandidate[]): Chip[] {
  return cands.map((c) => ({
    id: `regioncand-${c.cd}`,
    label: c.nm,
    action: {
      kind: 'answer',
      question: 'region',
      slots: { sigungu_cd: c.cd, sigungu_nm: c.nm },
    },
  }))
}

export function incomeChips(): Chip[] {
  const base: Chip[] = INCOME_OPTIONS.map((o) => ({
    id: `income-${o.value}`,
    label: o.label,
    hint: o.hint,
    action: {
      kind: 'answer',
      question: 'income',
      slots: { income_class: o.value, income_unknown: false },
    },
  }))
  base.push({
    id: 'income-unknown',
    label: '잘 모르겠어요',
    hint: '확인 방법을 알려드릴게요',
    action: {
      kind: 'answer',
      question: 'income',
      slots: { income_class: '그외', income_unknown: true },
    },
  })
  return base
}

export function disabilityChips(): Chip[] {
  return [
    {
      id: 'dis-no',
      label: '아니요 (비장애)',
      action: {
        kind: 'answer',
        question: 'disability',
        slots: { disability_has: false, disability_type: null },
      },
    },
    {
      id: 'dis-yes',
      label: '네, 장애 등록이 되어 있어요',
      action: { kind: 'answer', question: 'disability', slots: { disability_has: true } },
    },
  ]
}

export function disabilityTypeChips(): Chip[] {
  return DISABILITY_TYPES.map((t) => ({
    id: `distype-${t}`,
    label: `${t}장애`,
    action: {
      kind: 'answer',
      question: 'disability_type',
      slots: { disability_type: t },
    },
  }))
}

// 퀵스타트 칩(FR-12 AC5) — 클릭 1회 완주 + 기대 결과 라벨.
// ★ v1.4: 데모 페이지(/#/demo) 전용이다. 메인 랜딩에는 렌더하지 않는다.
export function personaChips(personas: DemoPersona[]): Chip[] {
  const chips: Chip[] = personas.map((p) => ({
    id: `persona-${p.id}`,
    label: `${p.id} · ${p.label}`,
    hint: p.summary,
    action: { kind: 'persona', personaId: p.id },
  }))
  chips.push({
    id: 'manual-start',
    label: '내 상황 직접 입력하기',
    hint: '나이·지역 등 5가지를 하나씩 골라요',
    action: { kind: 'manual_start' },
  })
  return chips
}

// ────────────────────────────── 질문 조립 ──────────────────────────────

export interface QuestionSpec {
  question: QuestionId
  text: string
  chips: Chip[]
  select: ChipQuestionMsg['select']
  searchable?: boolean
}

export function questionSpec(q: QuestionId, ctx: { sigungu: Sigungu[]; personas: DemoPersona[] }): QuestionSpec {
  switch (q) {
    case 'greet':
      return {
        question: 'greet',
        text: T.greet,
        chips: personaChips(ctx.personas),
        select: 'action',
      }
    case 'age':
      return { question: 'age', text: T.askAge, chips: ageChips(), select: 'single' }
    case 'sex':
      return { question: 'sex', text: T.askSex, chips: sexChips(), select: 'single' }
    case 'region':
      return {
        question: 'region',
        text: T.askRegion,
        chips: regionChips(ctx.sigungu),
        select: 'single',
        searchable: true,
      }
    case 'income':
      return { question: 'income', text: T.askIncome, chips: incomeChips(), select: 'single' }
    case 'disability':
      return {
        question: 'disability',
        text: T.askDisability,
        chips: disabilityChips(),
        select: 'single',
      }
    case 'disability_type':
      return {
        question: 'disability_type',
        text: T.askDisabilityType,
        chips: disabilityTypeChips(),
        select: 'single',
      }
  }
}

// 질문 순서: 나이 → 성별 → 지역 → 소득 → 장애(유무 → 유형).
export function nextQuestion(slots: ChatSlots): QuestionId | null {
  if (slots.age == null) return 'age'
  if (slots.sex == null) return 'sex'
  if (slots.sigungu_cd == null) return 'region'
  if (slots.income_class == null) return 'income'
  if (slots.disability_has == null) return 'disability'
  if (slots.disability_has && slots.disability_type == null) return 'disability_type'
  return null
}

// 미완 슬롯 안내(FR-12 AC6 "부족분 재질문").
export function missingLabels(slots: ChatSlots): string[] {
  const out: string[] = []
  if (slots.age == null) out.push('나이')
  if (slots.sex == null) out.push('성별')
  if (slots.sigungu_cd == null) out.push('지역')
  if (slots.income_class == null) out.push('소득 구분')
  if (slots.disability_has == null) out.push('장애 여부')
  else if (slots.disability_has && slots.disability_type == null) out.push('장애 유형')
  return out
}

export function slotsComplete(slots: ChatSlots): boolean {
  return nextQuestion(slots) === null
}

// 슬롯 → assess 요청. 완성 슬롯에서만 호출한다.
export function toAssessRequest(slots: ChatSlots, sigungu: Sigungu[]): AssessRequest | null {
  if (!slotsComplete(slots)) return null
  const sg = sigungu.find((s) => s.cd === slots.sigungu_cd)
  return {
    age: slots.age!,
    sex: slots.sex!,
    sigungu_cd: slots.sigungu_cd!,
    sigungu_nm: slots.sigungu_nm ?? sg?.nm ?? '',
    income_class: slots.income_class!,
    disability: {
      has: slots.disability_has === true,
      type: slots.disability_has ? slots.disability_type : null,
    },
    location: sg ? { lat: sg.lat, lon: sg.lon } : null,
  }
}

export function slotsFromRequest(req: AssessRequest): ChatSlots {
  return {
    age: req.age,
    sex: req.sex,
    sigungu_cd: req.sigungu_cd,
    sigungu_nm: req.sigungu_nm,
    income_class: req.income_class,
    income_unknown: false,
    disability_has: req.disability.has,
    disability_type: req.disability.type,
  }
}

// 답변 에코(사용자 버블) 라벨.
export function answerEcho(q: QuestionId, chip: Chip): string {
  switch (q) {
    case 'age':
      return `나이: ${chip.label}`
    case 'sex':
      return `성별: ${chip.label}`
    case 'region':
      return `지역: ${chip.label}`
    case 'income':
      return `소득 구분: ${chip.label}`
    case 'disability':
      return chip.label
    case 'disability_type':
      return `장애 유형: ${chip.label}`
    case 'greet':
      return chip.label
  }
}

// 슬롯 값 → 정정 칩 라벨(NLU 에코). 탭하면 해당 질문이 재개된다.
export function slotEditChips(changed: QuestionId[], slots: ChatSlots): Chip[] {
  const label = (q: QuestionId): string | null => {
    switch (q) {
      case 'age':
        return slots.age != null ? `나이 ${slots.age}세` : null
      case 'sex':
        return slots.sex ? `성별 ${SEX_LABEL[slots.sex]}` : null
      case 'region':
        return slots.sigungu_nm ? `지역 ${slots.sigungu_nm}` : null
      case 'income':
        return slots.income_class ? `소득 ${slots.income_class}` : null
      case 'disability':
        return slots.disability_has == null
          ? null
          : slots.disability_has
            ? '장애 있음'
            : '비장애'
      case 'disability_type':
        return slots.disability_type ? `유형 ${slots.disability_type}장애` : null
      case 'greet':
        return null
    }
  }
  const out: Chip[] = []
  for (const q of changed) {
    const l = label(q)
    if (l) out.push({ id: `edit-${q}`, label: l, hint: '눌러서 고치기', action: { kind: 'edit', question: q } })
  }
  return out
}

// 결과 뒤 후속 액션 칩(패널 열기 · 체력 · 다시 시작 · FAQ).
// 체력 레인을 막 끝낸 뒤에는 fitness=false 로 "체력 처방 시작"을 빼고 복귀 칩만 남긴다.
export function followUpChips(
  faqKeys: { key: string; q: string }[],
  // suffix = 같은 칩 묶음이 스트림에 두 번 이상 나올 때 id 충돌을 막는 꼬리표.
  opts: { fitness?: boolean; suffix?: string } = {},
): Chip[] {
  const tail = opts.suffix ? `-${opts.suffix}` : ''
  const chips: Chip[] = [
    { id: `act-map${tail}`, label: '지도에서 보기', action: { kind: 'open_panel', tab: 'map' } },
    { id: `act-list${tail}`, label: '시설 목록 보기', action: { kind: 'open_panel', tab: 'list' } },
  ]
  if (opts.fitness !== false) {
    chips.push({ id: `act-fitness${tail}`, label: '체력 처방 시작', action: { kind: 'start_fitness' } })
  }
  for (const f of faqKeys.slice(0, 3)) {
    chips.push({ id: `faq-${f.key}${tail}`, label: f.q, action: { kind: 'faq', faqKey: f.key } })
  }
  chips.push({
    id: `act-restart${tail}`,
    label: '처음부터 다시',
    action: { kind: 'restart', step: 'ask' },
  })
  return chips
}

export function restartConfirmChips(): Chip[] {
  return [
    { id: 'restart-yes', label: '네, 다시 시작할게요', action: { kind: 'restart', step: 'yes' } },
    { id: 'restart-no', label: '아니요, 계속할게요', action: { kind: 'restart', step: 'no' } },
  ]
}

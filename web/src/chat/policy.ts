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

// ── 연령 2단계 칩(FR-12 AC6 v1.5) ──────────────────────────────────────
//   1단계 연령대 → 2단계 그 구간의 세부 나이(+ 어느 단계서든 자유 입력 병행)
//
// ★ 구간은 "어떤 나이 칩을 보여줄지"만 정한다. 판정은 정확 나이로만 한다 —
//   구간 대표값(예: 20대 → 25세) 추정은 금지다(P-1·P-2). 자격 경계가
//   5·18·65세처럼 한 살 단위로 갈리기 때문에 대표값은 곧 오답이다.
export interface AgeBand {
  id: string
  label: string
  from: number
  to: number
  // 마지막 칸에서 한 단계 더 올라가는 상위 구간(70대 이상 → 80세 이상 → 90세 이상).
  next?: string
}

export const AGE_BANDS: AgeBand[] = [
  { id: 'u9', label: '9세 이하', from: 3, to: 9 },
  { id: '10s', label: '10대', from: 10, to: 19 },
  { id: '20s', label: '20대', from: 20, to: 29 },
  { id: '30s', label: '30대', from: 30, to: 39 },
  { id: '40s', label: '40대', from: 40, to: 49 },
  { id: '50s', label: '50대', from: 50, to: 59 },
  { id: '60s', label: '60대', from: 60, to: 69 },
  { id: '70s', label: '70대 이상', from: 70, to: 79, next: '80s' },
  // 아래 둘은 1단계 목록엔 없고, 앞 구간의 "더 위" 칩으로만 도달한다.
  { id: '80s', label: '80세 이상', from: 80, to: 89, next: '90s' },
  { id: '90s', label: '90세 이상', from: 90, to: 99 },
]

// 1단계에 노출하는 연령대(9세 이하 ~ 70대 이상 8개).
const AGE_BANDS_TOP = AGE_BANDS.filter((b) => b.id !== '80s' && b.id !== '90s')

export function ageBandOf(id: string | null): AgeBand | null {
  return AGE_BANDS.find((b) => b.id === id) ?? null
}

// 정확 나이 → 소속 구간(정정·프리필 시 세부 칩을 바로 그리기 위해).
export function ageBandForAge(age: number): string | null {
  return AGE_BANDS.find((b) => age >= b.from && age <= b.to)?.id ?? null
}

export const SEX_LABEL: Record<Sex, string> = { F: '여성', M: '남성' }

// ── 지역 2단계 칩(FR-12 AC1 v1.7) ──────────────────────────────────────
//   1단계 시도(시군구 코드 앞 2자리) → 2단계 그 시도의 시군구
//
// ★ 표는 "코드 → 이름"일 뿐이고, 실제로 어떤 시도를 보여줄지는 오직 데이터가 정한다 —
//   getSigungu() 결과에 존재하는 접두 2자리만 렌더한다(하드코딩 전수 렌더 금지).
//   어휘는 서버 chat.py SIDO_NAMES 와 같은 계열이며, 칩 라벨은 그중 가장 짧은 통칭을 쓴다.
//   별칭 배열은 컴포저 자유입력의 로컬 매칭("인천 서구")에 쓰인다.
export const SIDO_ALIASES: [prefix: string, names: string[]][] = [
  ['11', ['서울특별시', '서울시', '서울']],
  ['12', ['전남광주통합특별시', '광주전남', '전남광주']],
  ['26', ['부산광역시', '부산시', '부산']],
  ['27', ['대구광역시', '대구시', '대구']],
  ['28', ['인천광역시', '인천시', '인천']],
  ['29', ['광주광역시', '광주시', '광주']],
  ['30', ['대전광역시', '대전시', '대전']],
  ['31', ['울산광역시', '울산시', '울산']],
  ['36', ['세종특별자치시', '세종시', '세종']],
  ['41', ['경기도', '경기']],
  ['42', ['강원도', '강원']],
  ['43', ['충청북도', '충북']],
  ['44', ['충청남도', '충남']],
  ['45', ['전라북도', '전북']],
  ['46', ['전라남도', '전남']],
  ['47', ['경상북도', '경북']],
  ['48', ['경상남도', '경남']],
  ['50', ['제주특별자치도', '제주도', '제주']],
  ['51', ['강원특별자치도', '강원도', '강원']],
  ['52', ['전북특별자치도', '전라북도', '전북']],
]

const SIDO_SHORT: Record<string, string> = Object.fromEntries(
  SIDO_ALIASES.map(([cd, names]) => [cd, names[names.length - 1]]),
)

export function sidoCdOf(sigunguCd: string): string {
  return (sigunguCd || '').slice(0, 2)
}

// 짧은 통칭("서울"). 표에 없는 접두는 코드를 그대로 보여준다 — 지어내지 않는다(P-1).
export function sidoLabel(prefix: string): string {
  return SIDO_SHORT[prefix] ?? prefix
}

// 데이터에 실제로 존재하는 시도만, 코드 오름차순으로.
export function sidoList(list: Sigungu[]): string[] {
  const seen = new Set<string>()
  for (const s of list) seen.add(sidoCdOf(s.cd))
  return [...seen].sort()
}

export function sigunguOfSido(list: Sigungu[], prefix: string | null): Sigungu[] {
  if (!prefix) return list
  return list.filter((s) => sidoCdOf(s.cd) === prefix)
}

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

  // 연령 2단계(FR-12 AC6 v1.5): 연령대 → 세부 나이. 어느 쪽이든 자유 입력 병행.
  askAge: '먼저 나이를 알려주세요. 연령대를 고르시거나 직접 입력하셔도 돼요.',
  askAgeDetail: '몇 세이신지 골라 주세요.',
  askSex: '성별을 골라 주세요.',
  // 지역 2단계(FR-12 AC1 v1.7): 시도 → 시군구. 어느 쪽이든 아래 입력창에 직접 쓰셔도 된다.
  askSido: '어느 지역에 사시나요? 먼저 시·도를 골라 주세요.',
  askRegion: '시·군·구를 골라 주세요. 아래 입력창에 직접 쓰셔도 돼요.',
  // 컴포저 자유입력 로컬 매칭(FR-12 AC1 v1.7) — 못 찾았을 때는 지어내지 않고 다시 묻는다.
  regionNotFound: '그 이름의 지역을 목록에서 찾지 못했어요. 아래에서 골라 주시거나 다시 적어 주세요.',
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

  // 모바일 결과 덱 안내(FR-12 AC9 v1.7). 나비는 "어떻게 보는지"만 말한다 — 사실은 카드가 말한다.
  deckSwipe: '결과를 옆으로 넘기며 확인해 주세요.',

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

export function personaEchoText(p: DemoPersona): string {
  const dis = p.disability.has ? `${p.disability.type ?? ''}장애` : '비장애'
  return `${p.id} 상황으로 함께 살펴볼게요. ${p.age}세 ${SEX_LABEL[p.sex]} · ${p.sigungu_nm} · ${p.income_class} · ${dis}로 확인해요.`
}

// NLU 가 슬롯을 갱신했을 때의 에코 문구(정정 칩과 함께).
export const SLOT_ECHO_PROMPT = '이렇게 이해했어요. 다르면 눌러서 고쳐 주세요.'
export const REGION_AMBIGUOUS_PROMPT = '같은 이름의 지역이 여러 곳이에요. 어디신가요?'

// ────────────────────────────── 질문 → 칩 ──────────────────────────────

// 1단계: 연령대 칩.
export function ageBandChips(): Chip[] {
  return AGE_BANDS_TOP.map((b) => ({
    id: `ageband-${b.id}`,
    label: b.label,
    action: { kind: 'answer', question: 'age_band', slots: { age_band: b.id } },
  }))
}

// 2단계: 해당 구간의 세부 나이 칩. 마지막 구간에는 상위 구간으로 넘어가는 칩을 덧붙인다.
export function ageChips(bandId: string | null): Chip[] {
  const band = ageBandOf(bandId) ?? AGE_BANDS[0]
  const chips: Chip[] = []
  for (let a = band.from; a <= band.to; a += 1) {
    chips.push({
      id: `age-${a}`,
      label: `${a}세`,
      action: { kind: 'answer', question: 'age', slots: { age: a } },
    })
  }
  const next = ageBandOf(band.next ?? null)
  if (next) {
    chips.push({
      id: `ageband-${next.id}`,
      label: next.label,
      hint: '더 위 연령대를 볼게요',
      action: { kind: 'answer', question: 'age_band', slots: { age_band: next.id } },
    })
  }
  return chips
}

export function sexChips(): Chip[] {
  return (['F', 'M'] as Sex[]).map((s) => ({
    id: `sex-${s}`,
    label: SEX_LABEL[s],
    action: { kind: 'answer', question: 'sex', slots: { sex: s } },
  }))
}

// 지역 1단계: 시도 칩. 데이터에 있는 시도만 렌더한다.
export function sidoChips(list: Sigungu[]): Chip[] {
  return sidoList(list).map((cd) => ({
    id: `sido-${cd}`,
    label: sidoLabel(cd),
    action: { kind: 'answer', question: 'region_sido', slots: { sido_cd: cd } },
  }))
}

// 지역 2단계: 시군구 칩(라벨은 nm 그대로 — "성북구"). 개수 제한 없이 wrap 으로 흘린다.
// withSido = 여러 시도에 걸친 후보를 나열할 때(동명 시군구) 앞에 시도 통칭을 붙인다.
export function regionChips(list: Sigungu[], opts: { withSido?: boolean } = {}): Chip[] {
  return list.map((s) => ({
    id: `region-${s.cd}`,
    label: opts.withSido ? `${sidoLabel(sidoCdOf(s.cd))} ${s.nm}` : s.nm,
    action: {
      kind: 'answer',
      question: 'region',
      slots: { sigungu_cd: s.cd, sigungu_nm: s.nm, sido_cd: sidoCdOf(s.cd) },
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
      slots: { sigungu_cd: c.cd, sigungu_nm: c.nm, sido_cd: sidoCdOf(c.cd) },
    },
  }))
}

// ── 컴포저 자유입력의 로컬 결정론 매칭(FR-12 AC1 v1.7) ─────────────────
// LLM off/강등 모드에서도 "성북구"라고 쓰면 칩과 똑같이 확정되어야 한다.
// 판단 재료는 getSigungu() 목록뿐이고, 추측은 하지 않는다 — 정확히 1건일 때만 확정,
// 여러 건이면 후보 칩으로 되묻고, 0건이면 못 찾았다고 말한다(P-1).
function norm(s: string): string {
  return s.replace(/\s+/g, '')
}

// 입력 전체가 시도 이름 하나면 그 시도 코드. 아니면 null.
export function matchSido(raw: string): string | null {
  const q = norm(raw)
  if (q === '') return null
  for (const [cd, names] of SIDO_ALIASES) {
    if (names.some((n) => n === q)) return cd
  }
  return null
}

export function matchSigungu(list: Sigungu[], raw: string): Sigungu[] {
  const q = norm(raw)
  if (q === '') return []

  // "인천서구"처럼 시도가 앞에 붙어 있으면 그 시도로 좁힌 뒤 나머지로 찾는다.
  let pool = list
  let needle = q
  for (const [cd, names] of SIDO_ALIASES) {
    const hit = names.find((n) => q.startsWith(n) && q.length > n.length)
    if (!hit) continue
    const scoped = list.filter((s) => sidoCdOf(s.cd) === cd)
    if (scoped.length === 0) continue
    pool = scoped
    needle = q.slice(hit.length)
    break
  }
  if (needle === '') return pool

  const exact = pool.filter((s) => s.nm === needle)
  if (exact.length > 0) return exact
  return pool.filter((s) => s.nm.includes(needle) || needle.includes(s.nm))
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
}

export function questionSpec(
  q: QuestionId,
  ctx: { sigungu: Sigungu[]; personas: DemoPersona[]; slots?: ChatSlots },
): QuestionSpec {
  switch (q) {
    case 'greet':
      return {
        question: 'greet',
        text: T.greet,
        chips: personaChips(ctx.personas),
        select: 'action',
      }
    case 'age_band':
      return { question: 'age_band', text: T.askAge, chips: ageBandChips(), select: 'single' }
    case 'age': {
      const band = ageBandOf(ctx.slots?.age_band ?? null)
      return {
        question: 'age',
        text: band ? `${band.label} 중에서 ${T.askAgeDetail}` : T.askAgeDetail,
        chips: ageChips(ctx.slots?.age_band ?? null),
        select: 'single',
      }
    }
    case 'sex':
      return { question: 'sex', text: T.askSex, chips: sexChips(), select: 'single' }
    case 'region_sido':
      return {
        question: 'region_sido',
        text: T.askSido,
        chips: sidoChips(ctx.sigungu),
        select: 'single',
      }
    case 'region': {
      const sido = ctx.slots?.sido_cd ?? null
      return {
        question: 'region',
        text: sido ? `${sidoLabel(sido)} 안에서 ${T.askRegion}` : T.askRegion,
        chips: regionChips(sigunguOfSido(ctx.sigungu, sido)),
        select: 'single',
      }
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

// 질문 순서: 나이(연령대 → 세부 나이) → 성별 → 지역(시도 → 시군구) → 소득 → 장애(유무 → 유형).
// ★ age 가 채워지기 전에는 절대 다음으로 넘어가지 않는다 — 정확 나이 없이 판정 금지.
//   자유 입력("32살")이 age 를 바로 채우면 2단계는 통째로 건너뛴다. 지역도 같다 —
//   "성북구"가 시군구를 바로 채우면 시도 질문은 건너뛴다(FR-12 AC1 v1.7).
export function nextQuestion(slots: ChatSlots): QuestionId | null {
  if (slots.age == null) return slots.age_band == null ? 'age_band' : 'age'
  if (slots.sex == null) return 'sex'
  if (slots.sigungu_cd == null) return slots.sido_cd == null ? 'region_sido' : 'region'
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
    age_band: ageBandForAge(req.age),
    sex: req.sex,
    sido_cd: sidoCdOf(req.sigungu_cd),
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
    case 'age_band':
      return `연령대: ${chip.label}`
    case 'age':
      return `나이: ${chip.label}`
    case 'sex':
      return `성별: ${chip.label}`
    case 'region_sido':
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
      // 연령대·시도는 그 자체로 정정 대상이 아니다 —
      // 나이/지역 정정 칩 하나가 각 2단계 흐름 전체를 다시 연다.
      case 'age_band':
      case 'region_sido':
        return null
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

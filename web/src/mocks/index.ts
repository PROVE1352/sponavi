import type { AssessRequest, AssessResponse } from '../types'
import { mockAssess } from './engine'
import { PERSONA_REQUESTS, PERSONA_RESPONSES } from './personas'

export { PERSONA_REQUESTS, PERSONA_RESPONSES, FITNESS_RESPONSE } from './personas'
export { mockAssess, mockFitness } from './engine'
export { SIGUNGU } from './fixtures'

// 요청이 데모 페르소나와 일치하면 미리 만든 계약-형태 canned 응답을, 아니면 규칙 엔진 응답을 준다.
function matchPersonaId(req: AssessRequest): string | null {
  const hit = PERSONA_REQUESTS.find(
    (p) =>
      p.age === req.age &&
      p.sex === req.sex &&
      p.sigungu_cd === req.sigungu_cd &&
      p.income_class === req.income_class &&
      p.disability.has === req.disability.has &&
      (p.disability.type ?? null) === (req.disability.type ?? null),
  )
  return hit ? hit.id : null
}

export function resolveMockAssess(req: AssessRequest): AssessResponse {
  const pid = matchPersonaId(req)
  if (pid && PERSONA_RESPONSES[pid]) return PERSONA_RESPONSES[pid]
  return mockAssess(req)
}

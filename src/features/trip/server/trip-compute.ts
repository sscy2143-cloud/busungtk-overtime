/**
 * 서버 재계산 핵심 — 인증된 사용자와 DB 입력 원본만으로 계산하고 service_role RPC 로 저장한다.
 *
 * 요청 본문에서 읽는 것은 claimId 하나다. 계산 결과·규칙 버전·지역 표준시간·역할은 받지 않는다.
 * 규칙 버전·지역은 서버 번들의 엔진 상수(RULE_VERSION, REGIONS)를 쓰고, DB 활성 버전과 다르면 거부한다.
 */

import { RULE_VERSION } from '../engine'
import {
  NO_CALENDAR, REVIEW_NOTICE_CODES, addDays, computeClaimDays,
  type Actor, type ClaimHeader, type DayComputation, type HolidayCalendar, type IsoDate, type TripDayRecord,
} from '../data'
import type { ClaimRow, ComputeIO, ComputeRequest, ComputeResponse, DayRow } from './types'

const fail = (code: string, message: string): ComputeResponse => ({ ok: false, code, message })

/** 요청 본문에서 claimId 만 꺼낸다. 다른 필드는 존재해도 읽지 않는다 */
export function parseRequest(body: unknown): ComputeRequest | null {
  if (!body || typeof body !== 'object') return null
  const claimId = (body as Record<string, unknown>).claimId
  if (typeof claimId !== 'string' || !/^[0-9a-zA-Z-]{1,64}$/.test(claimId)) return null
  return { claimId }
}

const toDayRecord = (r: DayRow): TripDayRecord => ({ id: r.id, claimId: r.claim_id, employeeId: r.employee_id, date: r.work_date, entry: r.entry, revision: r.revision })

/** 계산을 허용하는 상태: 직원은 작성 중·되돌아온 건, 관리자는 제출된 건(수정 후 재계산)까지 */
function computeAllowed(claim: ClaimRow, actor: Actor): boolean {
  if (claim.status === 'draft' || claim.status === 'returned') return true
  if (claim.status === 'submitted') return actor.role === 'admin'
  return false
}

function isHeader(h: unknown): h is ClaimHeader {
  if (!h || typeof h !== 'object') return false
  const o = h as Record<string, unknown>
  return Array.isArray(o.regions) && !!o.schedule && typeof o.schedule === 'object'
}

export async function runTripCompute(jwt: string | undefined, body: unknown, io: ComputeIO): Promise<ComputeResponse> {
  const req = parseRequest(body)
  if (!req) return fail('BAD_REQUEST', 'claimId 가 필요합니다')
  if (!jwt) return fail('UNKNOWN_USER', '인증이 필요합니다')

  // 1. 누구인지 — JWT 로 서버가 판정. 역할은 employees 에서
  const userId = await io.userIdFromJwt(jwt)
  if (!userId) return fail('UNKNOWN_USER', '사용자를 확인할 수 없습니다. 다시 로그인하세요')
  const actor = await io.findEmployee(userId)
  if (!actor) return fail('UNKNOWN_USER', '직원 정보가 없습니다')

  // 2. 기능 스위치 (서버 값). 관리자는 검토 스위치로도 통과
  const employeeOn = await io.featureEnabled('employee_form')
  const adminOn = actor.role === 'admin' ? await io.featureEnabled('admin_review') : false
  if (!employeeOn && !adminOn) return fail('FEATURE_DISABLED', '출장수당 기능이 아직 열리지 않았습니다')

  // 3. 신청과 권한
  const claim = await io.loadClaim(req.claimId)
  if (!claim) return fail('NOT_FOUND', '신청을 찾을 수 없습니다')
  if (claim.employee_id !== actor.id && actor.role !== 'admin') return fail('FORBIDDEN', '본인 신청만 계산할 수 있습니다')
  if (!computeAllowed(claim, actor)) return fail('NOT_EDITABLE', '승인·반려·취소된 신청은 다시 계산하지 않습니다')
  if (!isHeader(claim.header)) return fail('CALC_INVARIANT', '신청 머리 정보 형식이 올바르지 않습니다')

  // 4. 규칙 버전 — 서버 번들과 DB 활성 버전이 같아야 한다 (배포 불일치 방지)
  const active = await io.activeRuleVersion()
  if (active !== RULE_VERSION) return fail('RULE_VERSION_MISMATCH', `서버 규칙 버전(${RULE_VERSION})과 DB 활성 버전(${active ?? '없음'})이 다릅니다`)

  // 5. DB 입력 원본
  const dayRows = await io.loadDays(claim.id)
  if (dayRows.length === 0) return fail('CALC_INCOMPLETE_SET', '근무일이 없습니다')
  const days = dayRows.map(toDayRecord)
  const dates = days.map((d) => d.date)

  const holidays = await io.loadVerifiedHolidays()
  const calendar: HolidayCalendar = holidays.dates.length > 0
    ? { holidays: new Set(holidays.dates), verified: true, source: holidays.source }
    : NO_CALENDAR

  const others = await io.loadOtherRequests(claim.employee_id, [...dates, ...dates.map(next)])
  const otherByDate = new Map<IsoDate, string[]>()
  for (const o of others) {
    const label = `야근 ${o.planned_start.slice(0, 5)}~${o.planned_end.slice(0, 5)} (${o.status})`
    otherByDate.set(o.date, [...(otherByDate.get(o.date) ?? []), label])
  }

  // 다음 날 연결 조회는 동기 함수가 필요하므로 미리 받아 둔다
  const nextDayRows = new Map<IsoDate, TripDayRecord>()
  for (const d of dates) {
    const nd = next(d)
    if (dates.includes(nd)) continue
    const row = await io.findOtherActiveDay(claim.employee_id, nd, claim.id)
    if (row) nextDayRows.set(nd, toDayRecord(row))
  }

  // 6. 계산 — 저장소에 기대지 않는 같은 함수
  const drafts = computeClaimDays({
    header: claim.header,
    employeeId: claim.employee_id,
    days,
    calendar,
    findActiveDay: (_e, date) => nextDayRows.get(date),
    otherRequestLookup: (_e, date) => otherByDate.get(date) ?? [],
  })

  const calcs: Record<string, DayComputation> = {}
  const reviewCodes: Record<string, string[]> = {}
  for (const d of drafts) {
    const { day, ...rest } = d
    calcs[day.id] = rest
    const flags = rest.result?.ok ? rest.result.flags.map((f) => f.code) : []
    const notices = rest.classification.notices.filter((n) => REVIEW_NOTICE_CODES.has(n.code)).map((n) => n.code)
    reviewCodes[day.id] = [...new Set([...flags, ...notices])]
  }

  // 7. 저장 — service_role 전용 RPC. 실패 코드는 RPC 의 예외 코드를 그대로 돌려준다
  let calcIds: Record<string, string>
  try {
    calcIds = await io.storeCalcs(claim.id, RULE_VERSION, calcs, actor.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const code = /^[A-Z_]+$/.test(msg.split(':')[0]) ? msg.split(':')[0] : 'STORE_FAILED'
    return fail(code, msg)
  }
  return { ok: true, claimId: claim.id, ruleVersion: RULE_VERSION, calcIds, reviewCodes }
}

const next = (d: IsoDate): IsoDate => addDays(d, 1)

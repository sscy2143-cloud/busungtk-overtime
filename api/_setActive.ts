// 퇴사(비활성화)·복직(재활성화) 처리 — 의존성 주입형 순수 로직 (D15).
// 파일명이 _ 로 시작하면 Vercel 이 별도 함수로 배포하지 않는다. api/admin-user.ts 가 호출한다.
// 원칙: 기록은 삭제하지 않는다(employees DELETE·auth deleteUser 없음). 접근 권한만 끈다/켠다.

export type Role = 'admin' | 'manager' | 'employee' | string

export interface TargetRow { id: string; role: Role; is_active: boolean }

export interface SetActiveDeps {
  getTarget(id: string): Promise<TargetRow | null>
  /** 활성 admin 수 (퇴사 대상 포함). 조회 실패 시 null */
  countActiveAdmins(): Promise<number | null>
  setEmployeeActive(id: string, active: boolean): Promise<{ error: boolean }>
  /** 현재 Auth 차단 여부. 조회 실패 시 null */
  isBanned(id: string): Promise<boolean | null>
  setBan(id: string, ban: boolean): Promise<{ error: boolean }>
}

export interface SetActiveInput {
  callerId: string
  callerRole: Role
  userId?: unknown
  active?: unknown
}

type StepState = 'ok' | 'failed' | 'skipped' | 'already'

export interface SetActiveResult {
  status: number
  body: {
    success: boolean
    error?: string
    steps?: { employee: StepState; auth: StepState }
    /** 처리 후 다시 조회한 실제 상태 (null = 조회 실패) */
    state?: { is_active: boolean | null; banned: boolean | null }
    retryable?: boolean
  }
}

export const BAN_DURATION = '876000h' // 약 100년. 복직 시 'none' 으로 해제

async function readState(deps: SetActiveDeps, id: string) {
  const t = await deps.getTarget(id)
  const banned = await deps.isBanned(id)
  return { is_active: t ? t.is_active : null, banned }
}

function fail(status: number, error: string): SetActiveResult {
  return { status, body: { success: false, error } }
}

export async function setActive(input: SetActiveInput, deps: SetActiveDeps): Promise<SetActiveResult> {
  const { callerId, callerRole, userId, active } = input
  if (typeof userId !== 'string' || !userId || typeof active !== 'boolean') {
    return fail(400, '사용자 ID와 활성 여부가 필요합니다')
  }
  if (userId === callerId) return fail(400, '본인 계정은 퇴사 처리할 수 없습니다')

  const target = await deps.getTarget(userId)
  if (!target) return fail(404, '직원을 찾을 수 없습니다')

  if (callerRole === 'manager' && target.role === 'admin') {
    return fail(403, '관리자 계정은 다른 관리자만 처리할 수 있습니다')
  }
  // 복직 시 과거 권한(manager/admin)이 그대로 되살아나므로, 권한 있던 직원의 복직은 admin 만 할 수 있다
  if (active && callerRole !== 'admin' && (target.role === 'admin' || target.role === 'manager')) {
    return fail(403, '관리 권한이 있던 직원의 복직은 관리자(대표)만 처리할 수 있습니다')
  }
  // 마지막 활성 admin 을 퇴사시키면 관리 불능이 된다
  if (!active && target.role === 'admin' && target.is_active) {
    const n = await deps.countActiveAdmins()
    if (n === null || n <= 1) return fail(409, '마지막 활성 관리자는 퇴사 처리할 수 없습니다')
  }

  const steps: { employee: StepState; auth: StepState } = { employee: 'skipped', auth: 'skipped' }
  const mismatch = '처리 후 상태가 예상과 다릅니다. 새로고침 후 확인하세요'

  if (active) {
    // 복직: 차단 해제 → 활성화. 해제가 실패하면 활성화하지 않는다(로그인 불가인 "활성" 상태 방지).
    if ((await deps.isBanned(userId)) === false) steps.auth = 'already'
    else {
      const r = await deps.setBan(userId, false)
      if (r.error) {
        steps.auth = 'failed'
        return { status: 500, body: { success: false, error: '인증 차단 해제에 실패했습니다. 다시 시도하세요', steps, state: await readState(deps, userId), retryable: true } }
      }
      steps.auth = 'ok'
    }
    if (target.is_active) steps.employee = 'already'
    else {
      const r = await deps.setEmployeeActive(userId, true)
      if (r.error) {
        steps.employee = 'failed'
        return { status: 500, body: { success: false, error: '차단은 해제됐지만 활성화에 실패했습니다. 같은 요청을 다시 보내면 이어서 처리됩니다', steps, state: await readState(deps, userId), retryable: true } }
      }
      steps.employee = 'ok'
    }
    const state = await readState(deps, userId)
    const ok = state.is_active === true && state.banned !== true
    return { status: ok ? 200 : 207, body: { success: ok, steps, state, ...(ok ? {} : { error: mismatch, retryable: true }) } }
  }

  // 퇴사: 비활성화(DB 접근 즉시 차단) → Auth 차단. 차단이 실패해도 비활성은 유지하고 207 로 재시도를 안내한다.
  if (!target.is_active) steps.employee = 'already'
  else {
    const r = await deps.setEmployeeActive(userId, false)
    if (r.error) {
      steps.employee = 'failed'
      return { status: 500, body: { success: false, error: '퇴사 처리(비활성화)에 실패했습니다', steps, state: await readState(deps, userId), retryable: true } }
    }
    steps.employee = 'ok'
  }
  if ((await deps.isBanned(userId)) === true) steps.auth = 'already'
  else {
    const r = await deps.setBan(userId, true)
    if (r.error) {
      steps.auth = 'failed'
      return { status: 207, body: { success: false, error: '비활성화는 됐지만 인증 차단에 실패했습니다. 같은 요청을 다시 보내면 이어서 처리됩니다', steps, state: await readState(deps, userId), retryable: true } }
    }
    steps.auth = 'ok'
  }
  const state = await readState(deps, userId)
  const ok = state.is_active === false && state.banned !== false
  return { status: ok ? 200 : 207, body: { success: ok, steps, state, ...(ok ? {} : { error: mismatch, retryable: true }) } }
}

/**
 * POST /api/trip-compute  { claimId }  — 출장 신청 서버 재계산 (계약: docs/출장수당/T5-DB-초안/계약-서버계산.md)
 *
 * - 사용자 JWT 를 anon 클라이언트로 검증하고, 그 뒤 모든 DB 접근은 service_role 로 한다 (api/admin-user.ts 와 같은 방식).
 * - 서비스 롤 키는 Vercel 환경변수(SUPABASE_SERVICE_ROLE_KEY)에만 있고 브라우저로 나가지 않는다.
 * - 계산·권한·기능 스위치 판정은 src/features/trip/server/trip-compute.ts 가 한다. 이 파일은 I/O 만 붙인다.
 * - 기능 스위치(trip_feature_flags)가 꺼져 있으면 FEATURE_DISABLED. 배포돼 있어도 아무것도 하지 않는다.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { HTTP_STATUS, runTripCompute, type ClaimRow, type ComputeIO, type DayRow } from '../src/features/trip/server/index.js'

const ACTIVE_CLAIM_STATUSES = ['draft', 'submitted', 'returned', 'approved']

function makeIO(service: SupabaseClient, anon: SupabaseClient): ComputeIO {
  const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
    if (r.error) throw new Error(`STORE_FAILED: ${r.error.message}`)
    return r.data as T
  }
  return {
    async userIdFromJwt(jwt) {
      const { data, error } = await anon.auth.getUser(jwt)
      return error || !data.user ? null : data.user.id
    },
    async findEmployee(userId) {
      const { data } = await service.from('employees').select('id, role').eq('id', userId).maybeSingle()
      if (!data) return null
      return { id: data.id as string, role: data.role === 'admin' ? 'admin' : 'employee' }
    },
    async featureEnabled(key) {
      const { data } = await service.rpc('trip_feature_enabled', { p_key: key })
      return data === true
    },
    async activeRuleVersion() {
      const { data } = await service.rpc('trip_active_rule_version')
      return typeof data === 'string' ? data : null
    },
    async loadClaim(claimId) {
      const { data } = await service.from('trip_claims').select('id, employee_id, group_id, origin, header, status, version').eq('id', claimId).maybeSingle()
      return (data as ClaimRow | null) ?? null
    },
    async loadDays(claimId) {
      const r = await service.from('trip_claim_days').select('id, claim_id, employee_id, work_date, entry, revision')
        .eq('claim_id', claimId).eq('is_removed', false).order('work_date')
      return must<DayRow[]>(r) ?? []
    },
    async findOtherActiveDay(employeeId, date, excludeClaimId) {
      const { data } = await service.from('trip_claim_days').select('id, claim_id, employee_id, work_date, entry, revision')
        .eq('employee_id', employeeId).eq('work_date', date).eq('is_removed', false).neq('claim_id', excludeClaimId)
        .in('claim_status', ACTIVE_CLAIM_STATUSES).limit(1).maybeSingle()
      return (data as DayRow | null) ?? null
    },
    async loadVerifiedHolidays() {
      const { data } = await service.from('holidays').select('holiday_date').eq('is_verified', true)
      const dates = (data ?? []).map((h: { holiday_date: string }) => h.holiday_date)
      return { dates, source: dates.length > 0 ? `holidays 테이블 (검증 ${dates.length}건)` : 'none' }
    },
    async loadOtherRequests(employeeId, dates) {
      const { data } = await service.from('overtime_requests').select('date, planned_start, planned_end, status')
        .eq('employee_id', employeeId).in('date', dates).not('status', 'in', '("cancelled","rejected")')
      return (data ?? []) as { date: string; planned_start: string; planned_end: string; status: string }[]
    },
    async storeCalcs(claimId, claimVersion, ruleVersion, calcs, computedBy) {
      const { data, error } = await service.rpc('trip_store_server_calcs', {
        p_claim_id: claimId, p_claim_version: claimVersion, p_rule_version: ruleVersion, p_calcs: calcs, p_computed_by: computedBy,
      })
      // PostgREST: RPC 의 raise exception '<코드>' 는 error.message 에 코드로 온다
      if (error) throw new Error(`${error.message}: ${(error as { details?: string }).details ?? ''}`)
      return data as Record<string, string>
    },
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://busungtk-overtime-beta.vercel.app'
  const origin = req.headers.origin
  if (origin === allowedOrigin || origin === 'https://busungtk-overtime.vercel.app' || process.env.NODE_ENV === 'development') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POST 만 받습니다' })

  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) return res.status(500).json({ ok: false, code: 'STORE_FAILED', message: '서버 환경변수가 없습니다' })

  const opts = { auth: { autoRefreshToken: false, persistSession: false } }
  const anon = createClient(url, anonKey, opts)
  const service = createClient(url, serviceKey, opts)

  const auth = req.headers.authorization
  const jwt = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined
  const result = await runTripCompute(jwt, req.body, makeIO(service, anon))
  return res.status(result.ok ? 200 : (HTTP_STATUS[result.code] ?? 500)).json(result)
}

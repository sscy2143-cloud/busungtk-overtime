/**
 * TripBackend 의 실제 구현 — PostgREST(Supabase REST) 와 Vercel 함수를 fetch 로 부른다.
 *
 * DB SDK 를 쓰지 않는 이유: 출장 기능 모듈은 기존 앱의 DB 클라이언트에 기대지 않는다(독립성 테스트).
 * 기존 앱과 붙일 때(T7)는 getAccessToken 에 기존 세션의 access_token 을 주면 된다 — 같은 JWT 로 같은 RLS 가 적용된다.
 *
 * 보안
 *  - 모든 요청에 사용자 JWT 를 Bearer 로 싣는다. 토큰이 없으면 서버를 부르지 않고 UNAUTHENTICATED.
 *  - apikey 는 anon 키(공개값). service_role 키는 이 코드 어디에도 없다 — 계산 저장은 서버 함수만 한다.
 *  - 오류 본문은 코드·안내문만 쓰고 그대로 화면에 올리지 않는다 (ui/messages.ts 가 문구를 정한다).
 */

import type { Result } from '../data'
import { fail, ok, type SelectQuery, type TripBackend } from './backend'

export interface FetchBackendOptions {
  /** DB REST 기본 주소. 예: https://<ref>.supabase.co */
  baseUrl: string
  anonKey: string
  /** 현재 세션의 access_token. 없으면 null */
  getAccessToken: () => Promise<string | null>
  /** 기본 '/api/trip-compute' (같은 origin 의 Vercel 함수) */
  computeUrl?: string
  /** 테스트용 */
  fetchImpl?: typeof fetch
}

interface PostgrestError { code?: string; message?: string; details?: string | null; hint?: string | null }

/** RPC 의 raise exception '<코드>' using detail = '<안내>' 는 message=코드, details=안내 로 온다 */
export function mapPostgrestError(status: number, body: PostgrestError | null): { code: string; message: string } {
  const msg = body?.message ?? ''
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(msg)) return { code: msg, message: body?.details || msg }
  if (status === 401) return { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다' }
  if (status === 403 || body?.code === '42501') return { code: 'FORBIDDEN', message: '권한이 없습니다' }
  if (status === 404 || body?.code === 'PGRST202' || body?.code === 'PGRST205') return { code: 'BACKEND_NOT_READY', message: '출장수당 서버 구성이 아직 적용되지 않았습니다' }
  return { code: 'STORE_FAILED', message: msg || `서버 오류 (${status})` }
}

const encodeValue = (v: string | boolean): string => {
  const s = String(v)
  // PostgREST 예약 문자(쉼표·괄호·따옴표)는 큰따옴표로 감싼다
  return /[,()"\s]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s
}

export function buildSelectUrl(base: string, table: string, q: SelectQuery = {}): string {
  const params = new URLSearchParams()
  params.set('select', q.columns && q.columns.length > 0 ? q.columns.join(',') : '*')
  for (const [col, v] of Object.entries(q.filter ?? {})) {
    if (Array.isArray(v)) params.set(col, `in.(${v.map(encodeValue).join(',')})`)
    else params.set(col, `eq.${encodeValue(v)}`)
  }
  if (q.order) params.set('order', q.order)
  return `${base}/rest/v1/${table}?${params.toString()}`
}

export function createFetchBackend(o: FetchBackendOptions): TripBackend {
  const f = o.fetchImpl ?? fetch
  const base = o.baseUrl.replace(/\/+$/, '')
  const computeUrl = o.computeUrl ?? '/api/trip-compute'

  async function headers(): Promise<Result<Record<string, string>>> {
    const token = await o.getAccessToken()
    if (!token) return fail('UNAUTHENTICATED', '로그인이 필요합니다')
    return ok({ apikey: o.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' })
  }

  async function readJson(res: Response): Promise<unknown> {
    const text = await res.text()
    if (!text) return null
    try { return JSON.parse(text) } catch { return null }
  }

  async function call<T>(url: string, init: RequestInit): Promise<Result<T>> {
    const h = await headers()
    if (!h.ok) return h
    let res: Response
    try {
      res = await f(url, { ...init, headers: { ...h.value, ...(init.headers as Record<string, string> | undefined) } })
    } catch {
      return fail('NETWORK', '서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도하세요')
    }
    const body = await readJson(res)
    if (!res.ok) {
      const e = mapPostgrestError(res.status, (body && typeof body === 'object') ? (body as PostgrestError) : null)
      return fail(e.code, e.message)
    }
    return ok(body as T)
  }

  return {
    async sessionUserId() {
      const token = await o.getAccessToken()
      if (!token) return null
      // JWT 의 sub — 서명은 서버(PostgREST)가 검증한다. 여기서는 화면 표시용으로만 읽는다
      try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        return typeof payload.sub === 'string' ? payload.sub : null
      } catch {
        return null
      }
    },
    select<T>(table: string, q?: SelectQuery) {
      return call<T[]>(buildSelectUrl(base, table, q), { method: 'GET' })
    },
    rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      return call<T>(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
    },
    async compute(claimId: string) {
      const h = await headers()
      if (!h.ok) return h
      let res: Response
      try {
        // 서버 함수는 Content-Type 과 Authorization 만 본다 (계약 1절). claimId 외의 필드는 보내지 않는다
        res = await f(computeUrl, { method: 'POST', headers: { Authorization: h.value.Authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ claimId }) })
      } catch {
        return fail('NETWORK', '계산 서버에 연결하지 못했습니다')
      }
      const body = await readJson(res) as { ok?: boolean; code?: string; message?: string; claimId?: string; ruleVersion?: string; calcIds?: Record<string, string>; reviewCodes?: Record<string, string[]> } | null
      if (!body || typeof body !== 'object') return fail('STORE_FAILED', `계산 서버 응답을 읽지 못했습니다 (${res.status})`)
      if (body.ok !== true) return fail(body.code ?? 'STORE_FAILED', body.message ?? '계산에 실패했습니다')
      return ok({ claimId: body.claimId ?? claimId, ruleVersion: body.ruleVersion ?? '', calcIds: body.calcIds ?? {}, reviewCodes: body.reviewCodes ?? {} })
    },
  }
}

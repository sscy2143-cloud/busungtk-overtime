import { describe, expect, it } from 'vitest'
import { buildSelectUrl, createFetchBackend, mapPostgrestError } from '../fetch-backend'

/** 가짜 JWT — 서명 없음. 백엔드는 sub 만 읽고 검증은 서버가 한다 */
const jwt = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub, role: 'authenticated' })).toString('base64url')}.s`

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>) {
  const calls: { url: string; init: RequestInit }[] = []
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, init })
    const r = await handler(url, init)
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { f, calls }
}

const BASE = 'https://example.supabase.co'

describe('조회 URL', () => {
  it('select·eq·in·order 를 PostgREST 문법으로 만든다', () => {
    expect(buildSelectUrl(BASE, 'trip_claim_days', { columns: ['id', 'entry'], filter: { claim_id: ['a', 'b'], is_removed: false }, order: 'work_date.asc' }))
      .toBe(`${BASE}/rest/v1/trip_claim_days?select=id%2Centry&claim_id=in.%28a%2Cb%29&is_removed=eq.false&order=work_date.asc`)
    expect(buildSelectUrl(BASE, 'employees')).toBe(`${BASE}/rest/v1/employees?select=*`)
  })

  it('예약 문자가 든 값은 따옴표로 감싼다', () => {
    expect(decodeURIComponent(buildSelectUrl(BASE, 't', { filter: { k: ['x,y', 'plain'] } }))).toContain('k=in.("x,y",plain)')
  })
})

describe('오류 매핑', () => {
  it('RPC 예외 코드는 message 에, 안내문은 details 에 온다', () => {
    expect(mapPostgrestError(400, { message: 'VERSION_CONFLICT', details: '다른 곳에서 먼저 수정되었습니다' })).toEqual({ code: 'VERSION_CONFLICT', message: '다른 곳에서 먼저 수정되었습니다' })
  })
  it('401 → UNAUTHENTICATED, 42501 → FORBIDDEN, 없는 함수·표 → BACKEND_NOT_READY, 그 외 → STORE_FAILED', () => {
    expect(mapPostgrestError(401, { message: 'JWT expired' }).code).toBe('UNAUTHENTICATED')
    expect(mapPostgrestError(400, { code: '42501', message: 'permission denied for function trip_store_server_calcs' }).code).toBe('FORBIDDEN')
    expect(mapPostgrestError(404, { code: 'PGRST202', message: 'Could not find the function' }).code).toBe('BACKEND_NOT_READY')
    expect(mapPostgrestError(500, { message: 'boom' })).toEqual({ code: 'STORE_FAILED', message: 'boom' })
  })
})

describe('요청 모양', () => {
  it('모든 호출에 anon apikey + 사용자 Bearer 를 싣고, 토큰이 없으면 부르지 않는다', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: [] }))
    const token = jwt('user-1')
    const be = createFetchBackend({ supabaseUrl: BASE + '/', anonKey: 'anon-key', getAccessToken: async () => token, fetchImpl: f })
    expect(await be.sessionUserId()).toBe('user-1')
    expect(await be.select('trip_claims', { columns: ['id'] })).toEqual({ ok: true, value: [] })
    const h = calls[0].init.headers as Record<string, string>
    expect(h.apikey).toBe('anon-key')
    expect(h.Authorization).toBe(`Bearer ${token}`)
    expect(calls[0].url).toBe(`${BASE}/rest/v1/trip_claims?select=id`)

    const none = createFetchBackend({ supabaseUrl: BASE, anonKey: 'anon-key', getAccessToken: async () => null, fetchImpl: f })
    expect(await none.sessionUserId()).toBeNull()
    expect(await none.rpc('trip_submit', {})).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' })
    expect(calls).toHaveLength(1)
  })

  it('rpc 는 /rest/v1/rpc/<fn> 에 인자를 그대로 JSON 으로 보내고, 예외는 코드로 돌아온다', async () => {
    const { f, calls } = fakeFetch((url) => url.endsWith('/rpc/trip_submit')
      ? { status: 409, body: { code: 'P0001', message: 'CALC_STALE_OR_UNTRUSTED', details: '다시 계산한 뒤 제출하세요' } }
      : { status: 200, body: { id: 'c1', version: 1 } })
    const be = createFetchBackend({ supabaseUrl: BASE, anonKey: 'k', getAccessToken: async () => jwt('u'), fetchImpl: f })
    expect(await be.rpc('trip_create_claim', { p_header: { regions: ['대전'] }, p_entries: [] })).toEqual({ ok: true, value: { id: 'c1', version: 1 } })
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ p_header: { regions: ['대전'] }, p_entries: [] })
    expect(await be.rpc('trip_submit', { p_claim_id: 'c1', p_expected_version: 1 })).toEqual({ ok: false, code: 'CALC_STALE_OR_UNTRUSTED', message: '다시 계산한 뒤 제출하세요' })
  })

  it('compute 는 같은 origin 의 /api/trip-compute 에 { claimId } 만 보낸다', async () => {
    const { f, calls } = fakeFetch((url) => url === '/api/trip-compute'
      ? { status: 200, body: { ok: true, claimId: 'c1', ruleVersion: 'v', calcIds: { d1: 'k1' }, reviewCodes: { d1: [] } } }
      : { status: 500 })
    const be = createFetchBackend({ supabaseUrl: BASE, anonKey: 'k', getAccessToken: async () => jwt('u'), fetchImpl: f })
    expect(await be.compute('c1')).toEqual({ ok: true, value: { claimId: 'c1', ruleVersion: 'v', calcIds: { d1: 'k1' }, reviewCodes: { d1: [] } } })
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ claimId: 'c1' })
    const h = calls[0].init.headers as Record<string, string>
    expect(h.apikey).toBeUndefined()
    expect(h.Authorization).toMatch(/^Bearer /)
  })

  it('compute 실패 응답은 코드 그대로, 본문이 JSON 이 아니면 STORE_FAILED, 연결 실패는 NETWORK', async () => {
    const { f } = fakeFetch(() => ({ status: 403, body: { ok: false, code: 'FEATURE_DISABLED', message: '아직' } }))
    const be = createFetchBackend({ supabaseUrl: BASE, anonKey: 'k', getAccessToken: async () => jwt('u'), fetchImpl: f })
    expect(await be.compute('c1')).toEqual({ ok: false, code: 'FEATURE_DISABLED', message: '아직' })

    const broken = createFetchBackend({ supabaseUrl: BASE, anonKey: 'k', getAccessToken: async () => jwt('u'), fetchImpl: (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch })
    expect(await broken.compute('c1')).toMatchObject({ ok: false, code: 'STORE_FAILED' })

    const down = createFetchBackend({ supabaseUrl: BASE, anonKey: 'k', getAccessToken: async () => jwt('u'), fetchImpl: (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch })
    expect(await down.select('trip_claims')).toMatchObject({ ok: false, code: 'NETWORK' })
    expect(await down.compute('c1')).toMatchObject({ ok: false, code: 'NETWORK' })
  })
})
